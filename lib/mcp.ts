// MCP server for A2AJ legal research operations.
// Exposes typed tools so agents never need Bash to hit the API or wrangle tempfiles.
//
// Tools (exposed to agents as mcp__a2aj__<name>):
//   search                — search cases or laws
//   fetch                 — fetch one case/law (returns metadata + full text)
//   locate_in_case        — fetch a case and pinpoint paragraph(s) containing a substring
//   extract_citations     — run the deterministic citation extractor on text
//   verify_quote          — verify a paragraph quote against the source case
//   summarize_treatment   — aggregate per-target classifier output into a status flag

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { fetchCase, searchCases, type DocType } from './a2aj.js';
import { extractCitations } from './citations.js';
import { extractParagraph, verifyQuote } from './verify.js';
import { summarizeTreatment, type TreatmentRecord } from './treatment-summary.js';

const docTypeEnum = z.enum(['cases', 'laws']);
const searchTypeEnum = z.enum(['full_text', 'name']);

function asText(payload: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [
      {
        type: 'text',
        text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function paragraphsContaining(text: string, needle: string, contextRadius = 1): Array<{
  paragraph: number;
  before: Array<{ paragraph: number; text: string }>;
  match: { paragraph: number; text: string };
  after: Array<{ paragraph: number; text: string }>;
}> {
  const needleLower = needle.toLowerCase();
  // Paragraph markers are `[N]` at the start of a line, where N is a small integer.
  // The cap excludes year-form report citations (`[2014] 3 SCR 494`, `[1995] 1 SCR 489`)
  // that also happen to sit on their own line in case metadata blocks.
  const MAX_PARAGRAPH = 999;
  const markerRe = /(?:^|\n)\s*\[(\d+)\]/g;
  const markers: Array<{ num: number; index: number; markerLen: number }> = [];
  for (const m of text.matchAll(markerRe)) {
    const numStr = m[1]!;
    const num = Number.parseInt(numStr, 10);
    if (num > MAX_PARAGRAPH) continue;
    const tokenOffset = m[0].lastIndexOf('[');
    markers.push({
      num,
      index: m.index! + tokenOffset,
      markerLen: numStr.length + 2,
    });
  }
  if (markers.length === 0) return [];

  const matchedParaNums = new Set<number>();
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i]!.index + `[${markers[i]!.num}]`.length;
    const end = i + 1 < markers.length ? markers[i + 1]!.index : text.length;
    const slice = text.slice(start, end);
    if (slice.toLowerCase().includes(needleLower)) {
      matchedParaNums.add(markers[i]!.num);
    }
  }

  const indexByNum = new Map<number, number>();
  markers.forEach((m, idx) => {
    if (!indexByNum.has(m.num)) indexByNum.set(m.num, idx);
  });

  function paragraphText(idx: number): { paragraph: number; text: string } {
    const m = markers[idx]!;
    const start = m.index + m.markerLen;
    const end = idx + 1 < markers.length ? markers[idx + 1]!.index : text.length;
    return { paragraph: m.num, text: text.slice(start, end).trim() };
  }

  const results: ReturnType<typeof paragraphsContaining> = [];
  for (const num of matchedParaNums) {
    const idx = indexByNum.get(num)!;
    const before: Array<{ paragraph: number; text: string }> = [];
    for (let j = Math.max(0, idx - contextRadius); j < idx; j++) {
      before.push(paragraphText(j));
    }
    const match = paragraphText(idx);
    const after: Array<{ paragraph: number; text: string }> = [];
    for (let j = idx + 1; j <= Math.min(markers.length - 1, idx + contextRadius); j++) {
      after.push(paragraphText(j));
    }
    results.push({ paragraph: num, before, match, after });
  }
  return results;
}

export function buildServer(): McpServer {
  const server = new McpServer({
    name: 'a2aj',
    version: '0.1.0',
  });

  server.registerTool(
    'search',
    {
      description:
        'Search the A2AJ corpus for cases or laws. Returns the raw search response (results array). Pass --datasets to scope to specific courts (BCSC, BCCA, SCC, etc.) — unscoped searches are noisy.',
      inputSchema: {
        query: z.string().describe('Search query. The server URL-encodes for you.'),
        search_type: searchTypeEnum.optional().default('full_text'),
        doc_type: docTypeEnum.optional().default('cases'),
        datasets: z.array(z.string()).optional().describe('Dataset codes, e.g. ["BCSC","SCC"].'),
        size: z.number().int().positive().max(50).optional().default(10),
        start_date: z.string().optional().describe('YYYY-MM-DD'),
        end_date: z.string().optional().describe('YYYY-MM-DD'),
      },
    },
    async ({ query, search_type, doc_type, datasets, size, start_date, end_date }) => {
      const resp = await searchCases({
        query,
        searchType: search_type as 'full_text' | 'name',
        docType: doc_type as DocType,
        datasets,
        size,
        startDate: start_date,
        endDate: end_date,
      });
      return asText({
        count: resp.results?.length ?? 0,
        results: resp.results ?? [],
      });
    },
  );

  server.registerTool(
    'fetch',
    {
      description:
        'Fetch one case or law by neutral citation. Returns metadata plus full text (cases: unofficial_text_en; laws: serialized section content). On not-found, returns { found: false }.',
      inputSchema: {
        citation: z.string(),
        doc_type: docTypeEnum.optional().default('cases'),
      },
    },
    async ({ citation, doc_type }) => {
      const result = await fetchCase(citation, doc_type as DocType);
      if (!result) {
        return asText({ found: false, citation, doc_type });
      }
      const text =
        doc_type === 'cases'
          ? typeof result.unofficial_text_en === 'string'
            ? result.unofficial_text_en
            : ''
          : serializeLawContent(result);
      const { unofficial_text_en, content, ...metadata } = result as Record<string, unknown>;
      void unofficial_text_en;
      void content;
      return asText({
        found: true,
        citation,
        doc_type,
        metadata,
        text,
      });
    },
  );

  server.registerTool(
    'locate_in_case',
    {
      description:
        'Fetch a case and locate every paragraph containing the given substring (case-insensitive). Returns the paragraph number(s), the matching paragraph text, and 1 paragraph of context on each side. Use this for forward note-up — find where a citing case mentions a target citation.',
      inputSchema: {
        citation: z.string().describe('The citing case to fetch.'),
        needle: z.string().describe('Substring to locate (e.g. a neutral citation or case name).'),
        context_radius: z
          .number()
          .int()
          .nonnegative()
          .max(5)
          .optional()
          .default(1)
          .describe('How many paragraphs of context on each side of a match.'),
      },
    },
    async ({ citation, needle, context_radius }) => {
      const result = await fetchCase(citation, 'cases');
      if (!result || typeof result.unofficial_text_en !== 'string') {
        return asText({
          found: false,
          citation,
          reason: 'case not in A2AJ corpus or no text available',
        });
      }
      const matches = paragraphsContaining(result.unofficial_text_en, needle, context_radius);
      return asText({
        found: true,
        citation,
        name: result.name_en ?? null,
        needle,
        match_count: matches.length,
        matches,
      });
    },
  );

  server.registerTool(
    'extract_citations',
    {
      description:
        'Run the deterministic citation extractor on a block of text. Returns the array of { citation, type, pinpoint? } that the Reader emits in its digest.',
      inputSchema: {
        text: z.string(),
      },
    },
    async ({ text }) => {
      return asText(extractCitations(text));
    },
  );

  server.registerTool(
    'verify_quote',
    {
      description:
        'Verify that a verbatim quote appears in the named paragraph of a case in the A2AJ corpus. Returns { ok: true } on success; { ok: false, reason } if the citation, paragraph, or quote is not located. Mirrors the Auditor\'s verify.js check exactly.',
      inputSchema: {
        citation: z.string(),
        para: z.number().int().positive(),
        quote: z.string(),
      },
    },
    async ({ citation, para, quote }) => {
      const result = await fetchCase(citation, 'cases');
      if (!result || typeof result.unofficial_text_en !== 'string') {
        return asText({ ok: false, reason: 'CITATION_NOT_FOUND', citation });
      }
      const paragraph = extractParagraph(result.unofficial_text_en, para);
      if (paragraph === null) {
        return asText({ ok: false, reason: 'PARAGRAPH_NOT_FOUND', citation, para });
      }
      if (!verifyQuote(paragraph, quote)) {
        return asText({
          ok: false,
          reason: 'QUOTE_NOT_FOUND_AT_PARA',
          citation,
          para,
          paragraph_preview: paragraph.slice(0, 240).replace(/\s+/g, ' ').trim(),
        });
      }
      return asText({ ok: true, citation, para });
    },
  );

  const treatmentLabelEnum = z.enum([
    'followed',
    'applied',
    'distinguished',
    'criticized',
    'neutral',
    'overruled',
    'reversed',
  ]);

  const treatmentRecordSchema = z.object({
    targetCase: z.string(),
    citingCase: z.string(),
    citingCaseName: z.string().optional(),
    paragraph: z.number().int().nonnegative(),
    label: treatmentLabelEnum,
    evidenceQuote: z.string(),
  });

  server.registerTool(
    'summarize_treatment',
    {
      description:
        'Aggregate TreatmentClassifier output for ONE target case into a status flag the Synthesizer can act on. Returns { status, statusBasis, counts, negativeSignals }. status is one of: good_law, questioned, overruled, reversed, unknown. Status logic: any reversed → reversed; any overruled → overruled; any criticized from an appellate court (or ≥2 from trial) → questioned; otherwise good_law. Pass the full treatments[] from the classifier — the function filters to entries matching target_case itself.',
      inputSchema: {
        target_case: z.string().describe('The cited (target) case neutral citation.'),
        treatments: z.array(treatmentRecordSchema).describe(
          'The full treatments[] array from one or more TreatmentClassifier outputs. Records whose targetCase does not match target_case are ignored.',
        ),
      },
    },
    async ({ target_case, treatments }) => {
      const summary = summarizeTreatment(target_case, treatments as TreatmentRecord[]);
      return asText(summary);
    },
  );

  return server;
}

function serializeLawContent(result: Record<string, unknown>): string {
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
  const t = result.unofficial_text_en;
  return typeof t === 'string' ? t : '';
}

const isMain = process.argv[1]?.endsWith('mcp.js');
if (isMain) {
  const server = buildServer();
  const transport = new StdioServerTransport();
  server.connect(transport).catch((err) => {
    process.stderr.write(`a2aj mcp server error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
