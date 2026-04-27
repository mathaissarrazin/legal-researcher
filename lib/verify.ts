// Deterministic citation/quote verifier. Used by the Auditor subagent.
//
// CLI:
//   node verify.js --citation "2014 SCC 71" --para 33 --quote "incremental steps"
//
// Exit codes:
//   0 — citation exists, paragraph found, quote substring present
//   1 — citation+paragraph found but quote substring not present
//   2 — citation not found in A2AJ (or no text available)
//   3 — bad usage / argument error

import { fetchCase } from './a2aj.js';

interface ParsedArgs {
  citation: string;
  para: number;
  quote: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    if (i === -1) return undefined;
    return argv[i + 1];
  };
  const citation = get('--citation');
  const paraStr = get('--para');
  const quote = get('--quote');
  if (!citation || !paraStr || !quote) {
    throw new Error('Usage: verify --citation "<>" --para <n> --quote "<>"');
  }
  const para = Number.parseInt(paraStr, 10);
  if (!Number.isFinite(para) || para <= 0) {
    throw new Error(`--para must be a positive integer, got "${paraStr}"`);
  }
  return { citation, para, quote };
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function extractParagraph(text: string, paraNum: number): string | null {
  // Paragraphs are marked as `[N]` at the start of a paragraph.
  const marker = `[${paraNum}]`;
  const idx = text.indexOf(marker);
  if (idx === -1) return null;
  const start = idx + marker.length;
  // Find the next paragraph marker (any number) — that's the end of this paragraph.
  const nextRe = /\[\d+\]/g;
  nextRe.lastIndex = start;
  const next = nextRe.exec(text);
  const end = next ? next.index : Math.min(text.length, start + 5000);
  return text.slice(start, end);
}

export function verifyQuote(paragraphText: string, quote: string): boolean {
  return normalize(paragraphText).includes(normalize(quote));
}

async function main() {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`USAGE_ERROR: ${msg}\n`);
    process.exitCode = 3;
    return;
  }

  const result = await fetchCase(parsed.citation);
  if (!result || !result.unofficial_text_en) {
    process.stderr.write(
      `CITATION_NOT_FOUND: ${parsed.citation} (not in A2AJ corpus, or no text available)\n`,
    );
    process.exitCode = 2;
    return;
  }

  const paragraph = extractParagraph(result.unofficial_text_en, parsed.para);
  if (paragraph === null) {
    process.stderr.write(
      `PARAGRAPH_NOT_FOUND: [${parsed.para}] not located in ${parsed.citation}\n`,
    );
    process.exitCode = 1;
    return;
  }

  if (!verifyQuote(paragraph, parsed.quote)) {
    const preview = paragraph.slice(0, 240).replace(/\s+/g, ' ').trim();
    process.stderr.write(
      `QUOTE_NOT_FOUND_AT_PARA: ${parsed.citation} para ${parsed.para}\n` +
        `  expected (substring, case/whitespace insensitive): ${parsed.quote.slice(0, 120)}\n` +
        `  paragraph starts: ${preview}\n`,
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`OK ${parsed.citation} para ${parsed.para}\n`);
  process.exitCode = 0;
}

const isMain = process.argv[1]?.endsWith('verify.js');
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`verify.js error: ${err.message}\n`);
    process.exitCode = 2;
  });
}
