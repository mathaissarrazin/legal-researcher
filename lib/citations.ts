// Citation extractor for Canadian neutral and traditional citations.
// Used by: Reader subagent (to extract internal citations from fetched cases),
// Auditor (indirectly via verify.ts).

export interface ExtractedCitation {
  citation: string;
  type: 'neutral' | 'traditional';
  pinpoint?: string;
}

const NEUTRAL_COURT_CODES = [
  'SCC', 'FCA', 'FC', 'TCC', 'CMAC',
  'BCCA', 'BCSC', 'BCPC',
  'ONCA', 'ONSC', 'ONCJ',
  'ABCA', 'ABKB', 'ABQB', 'ABPC',
  'QCCA', 'QCCS', 'QCCQ',
  'NSCA', 'NSSC', 'NSPC', 'NSFC', 'NSSM',
  'YKCA', 'YKSC',
  'RAD', 'RPD', 'CHRT', 'SST', 'RLLR',
] as const;

const NEUTRAL_RE = new RegExp(
  `\\b(19|20)\\d{2}\\s+(${NEUTRAL_COURT_CODES.join('|')})\\s+\\d+\\b`,
  'g',
);

const TRADITIONAL_RE = /\[\d{4}\]\s+\d+\s+(SCR|FC|CTC|DLR|CCC)\s+\d+/g;

const PINPOINT_RE = /\bat\s+para(?:s|graph|graphs)?\.?\s+(\d+(?:\s*[-–]\s*\d+)?)/i;

export function extractCitations(text: string): ExtractedCitation[] {
  const found: ExtractedCitation[] = [];
  const seen = new Set<string>();

  const collect = (match: RegExpExecArray, type: 'neutral' | 'traditional') => {
    const citation = match[0].replace(/\s+/g, ' ').trim();
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 60);
    const pinMatch = after.match(PINPOINT_RE);
    const pinpoint = pinMatch ? pinMatch[1].replace(/\s+/g, '') : undefined;
    const key = `${citation}|${pinpoint ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ citation, type, ...(pinpoint ? { pinpoint } : {}) });
  };

  let m: RegExpExecArray | null;
  NEUTRAL_RE.lastIndex = 0;
  while ((m = NEUTRAL_RE.exec(text)) !== null) collect(m, 'neutral');

  TRADITIONAL_RE.lastIndex = 0;
  while ((m = TRADITIONAL_RE.exec(text)) !== null) collect(m, 'traditional');

  return found;
}

// CLI entry point: read text from stdin or --text flag, output JSON to stdout.
async function main() {
  const args = process.argv.slice(2);
  let text = '';

  const textFlag = args.indexOf('--text');
  if (textFlag !== -1 && args[textFlag + 1] !== undefined) {
    text = args[textFlag + 1];
  } else {
    // Read from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    text = Buffer.concat(chunks).toString('utf8');
  }

  if (!text) {
    process.stderr.write('Usage: node citations.js --text "<text>"  OR  echo "<text>" | node citations.js\n');
    process.exit(2);
  }

  const citations = extractCitations(text);
  process.stdout.write(JSON.stringify(citations, null, 2) + '\n');
}

const isMain = import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`
  || process.argv[1]?.endsWith('citations.js');

if (isMain) {
  main().catch((err) => {
    process.stderr.write(`citations.js error: ${err.message}\n`);
    process.exit(2);
  });
}
