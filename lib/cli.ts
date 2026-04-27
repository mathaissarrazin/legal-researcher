// Single-binary CLI wrapper for A2AJ.
//
// Subcommands:
//   search  --query "..." [--search-type full_text|name] [--doc-type cases|laws]
//           [--dataset BCSC,BCCA,SCC] [--size 20] [--start-date YYYY-MM-DD]
//           [--end-date YYYY-MM-DD] [--min-results N] --out /tmp/lr-q.json
//
//   fetch   --citation "..." [--doc-type cases|laws]
//           [--out /tmp/lr-fetch.json] [--text-out /tmp/lr-text.txt]
//
// Exit codes:
//   0 — success
//   1 — HTTP / network / parse error
//   2 — not found (fetch returned no results)
//   3 — bad usage / argument error
//   4 — search returned fewer than --min-results
//
// Side-effect contract:
//   - On non-zero exit, no output file is created.
//   - On zero exit, --out is a complete JSON file.
//   - One-line summary is always written to stderr so the agent has a signal.

import { writeFileSync } from 'node:fs';
import { fetchCase, searchCases, type DocType } from './a2aj.js';

interface ArgMap {
  [flag: string]: string | undefined;
}

function parseFlags(argv: string[]): ArgMap {
  const out: ArgMap = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok.startsWith('--')) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out[tok] = '';
      } else {
        out[tok] = next;
        i++;
      }
    }
  }
  return out;
}

function requireFlag(args: ArgMap, flag: string): string {
  const v = args[flag];
  if (v === undefined || v === '') {
    throw new Error(`USAGE_ERROR: missing ${flag}`);
  }
  return v;
}

function parseDocType(v: string | undefined, fallback: DocType): DocType {
  if (v === undefined || v === '') return fallback;
  if (v !== 'cases' && v !== 'laws') {
    throw new Error(`USAGE_ERROR: --doc-type must be 'cases' or 'laws', got '${v}'`);
  }
  return v;
}

function parseSearchType(v: string | undefined): 'full_text' | 'name' {
  if (v === undefined || v === '') return 'full_text';
  if (v !== 'full_text' && v !== 'name') {
    throw new Error(`USAGE_ERROR: --search-type must be 'full_text' or 'name', got '${v}'`);
  }
  return v;
}

function parsePositiveInt(v: string | undefined, flag: string): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`USAGE_ERROR: ${flag} must be a positive integer, got '${v}'`);
  }
  return n;
}

async function runSearch(args: ArgMap): Promise<void> {
  const query = requireFlag(args, '--query');
  const out = requireFlag(args, '--out');
  const searchType = parseSearchType(args['--search-type']);
  const docType = parseDocType(args['--doc-type'], 'cases');
  const size = parsePositiveInt(args['--size'], '--size');
  const minResults = parsePositiveInt(args['--min-results'], '--min-results');
  const datasets = args['--dataset']
    ? args['--dataset']!.split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;
  const startDate = args['--start-date'] || undefined;
  const endDate = args['--end-date'] || undefined;

  const resp = await searchCases({
    query,
    searchType,
    docType,
    datasets,
    size,
    startDate,
    endDate,
  });

  const count = resp.results?.length ?? 0;
  writeFileSync(out, JSON.stringify(resp, null, 2));

  const datasetLabel = datasets ? datasets.join(',') : 'all';
  process.stderr.write(
    `a2aj: search returned ${count} ${docType} (datasets=${datasetLabel}, type=${searchType}) → ${out}\n`,
  );

  if (minResults !== undefined && count < minResults) {
    process.stderr.write(
      `a2aj: MIN_RESULTS_NOT_MET — got ${count}, expected at least ${minResults}\n`,
    );
    process.exitCode = 4;
  }
}

async function runFetch(args: ArgMap): Promise<void> {
  const citation = requireFlag(args, '--citation');
  const docType = parseDocType(args['--doc-type'], 'cases');
  const out = args['--out'];
  const textOut = args['--text-out'];

  if (!out && !textOut) {
    throw new Error('USAGE_ERROR: fetch requires --out and/or --text-out');
  }

  const result = await fetchCase(citation, docType);
  if (!result) {
    process.stderr.write(
      `a2aj: NOT_FOUND ${citation} (${docType}) — not in A2AJ corpus, or no text available\n`,
    );
    process.exitCode = 2;
    return;
  }

  if (out) {
    writeFileSync(out, JSON.stringify({ results: [result] }, null, 2));
  }

  if (textOut) {
    const text = extractText(result, docType);
    if (!text) {
      process.stderr.write(
        `a2aj: NO_TEXT ${citation} (${docType}) — fetched record has no extractable text\n`,
      );
      process.exitCode = 2;
      return;
    }
    writeFileSync(textOut, text);
  }

  const name = (result.name_en as string | undefined) ?? citation;
  const parts: string[] = [];
  if (out) parts.push(out);
  if (textOut) parts.push(textOut);
  process.stderr.write(`a2aj: fetched ${citation} (${name}) → ${parts.join(', ')}\n`);
}

function extractText(result: Record<string, unknown>, docType: DocType): string {
  if (docType === 'cases') {
    const t = result.unofficial_text_en;
    return typeof t === 'string' ? t : '';
  }
  // doc_type=laws: response includes a `content` array of sections; serialize to text.
  const content = result.content;
  if (Array.isArray(content)) {
    return content
      .map((section) => {
        if (typeof section === 'string') return section;
        if (section && typeof section === 'object') {
          const obj = section as Record<string, unknown>;
          const heading = typeof obj.heading_en === 'string' ? obj.heading_en : '';
          const body =
            typeof obj.text_en === 'string'
              ? obj.text_en
              : typeof obj.content === 'string'
                ? obj.content
                : '';
          return [heading, body].filter(Boolean).join('\n');
        }
        return '';
      })
      .filter(Boolean)
      .join('\n\n');
  }
  // Fallback: some laws responses might still expose unofficial_text_en.
  const t = result.unofficial_text_en;
  return typeof t === 'string' ? t : '';
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const sub = argv[0];
  const rest = argv.slice(1);

  if (!sub || sub === '--help' || sub === '-h') {
    process.stderr.write(
      'Usage:\n' +
        '  a2aj search --query "..." [--search-type full_text|name]\n' +
        '              [--doc-type cases|laws] [--dataset CSV] [--size N]\n' +
        '              [--start-date YYYY-MM-DD] [--end-date YYYY-MM-DD]\n' +
        '              [--min-results N] --out PATH\n' +
        '  a2aj fetch  --citation "..." [--doc-type cases|laws]\n' +
        '              [--out PATH] [--text-out PATH]\n',
    );
    process.exitCode = 3;
    return;
  }

  const args = parseFlags(rest);

  if (sub === 'search') {
    await runSearch(args);
    return;
  }
  if (sub === 'fetch') {
    await runFetch(args);
    return;
  }
  throw new Error(`USAGE_ERROR: unknown subcommand '${sub}'`);
}

const isMain = process.argv[1]?.endsWith('cli.js');
if (isMain) {
  main().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`a2aj: ${msg}\n`);
    if (msg.startsWith('USAGE_ERROR')) {
      process.exitCode = 3;
    } else {
      process.exitCode = 1;
    }
  });
}
