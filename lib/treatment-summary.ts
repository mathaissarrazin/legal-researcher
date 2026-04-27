// Aggregates per-target TreatmentClassifier output into a single status flag
// the Synthesizer can act on without re-reading every classification.
//
// Status logic (in order of precedence):
//   reversed    — any citing case labelled `reversed`
//   overruled   — any citing case labelled `overruled`
//   questioned  — any `criticized` from an appellate court, OR multiple `criticized` from any court
//   good_law    — only positive (followed/applied) or neutral/distinguished treatments
//   unknown     — no usable treatment data (empty input)

export type TreatmentLabel =
  | 'followed'
  | 'applied'
  | 'distinguished'
  | 'criticized'
  | 'neutral'
  | 'overruled'
  | 'reversed';

export interface TreatmentRecord {
  targetCase: string;
  citingCase: string;
  citingCaseName?: string;
  paragraph: number;
  label: TreatmentLabel;
  evidenceQuote: string;
}

export type TreatmentStatus =
  | 'good_law'
  | 'questioned'
  | 'overruled'
  | 'reversed'
  | 'unknown';

export interface TreatmentSummary {
  targetCase: string;
  status: TreatmentStatus;
  statusBasis: string;
  counts: Record<TreatmentLabel, number>;
  negativeSignals: Array<{
    citingCase: string;
    citingCaseName?: string;
    paragraph: number;
    label: TreatmentLabel;
    citingCourtLevel: CourtLevel;
    evidenceQuote: string;
  }>;
}

export type CourtLevel = 'apex' | 'appellate' | 'trial' | 'tribunal' | 'unknown';

const APEX_CODES = new Set(['SCC']);
const APPELLATE_CODES = new Set([
  'FCA',
  'BCCA',
  'ONCA',
  'ABCA',
  'QCCA',
  'NSCA',
  'MBCA',
  'SKCA',
  'NBCA',
  'NLCA',
  'PECA',
  'YKCA',
  'NTCA',
  'NUCA',
  'CMAC',
]);
const TRIBUNAL_CODES = new Set(['RAD', 'RPD', 'CHRT', 'SST', 'RLLR']);

const NEUTRAL_RE = /\b(19|20)\d{2}\s+([A-Z]+)\s+\d+\b/;

export function courtLevelFromCitation(citation: string): CourtLevel {
  const m = NEUTRAL_RE.exec(citation);
  if (!m) return 'unknown';
  const code = m[2]!;
  if (APEX_CODES.has(code)) return 'apex';
  if (APPELLATE_CODES.has(code)) return 'appellate';
  if (TRIBUNAL_CODES.has(code)) return 'tribunal';
  // Anything else with a recognized neutral-citation shape we treat as trial.
  return 'trial';
}

const ZERO_COUNTS = (): Record<TreatmentLabel, number> => ({
  followed: 0,
  applied: 0,
  distinguished: 0,
  criticized: 0,
  neutral: 0,
  overruled: 0,
  reversed: 0,
});

export function summarizeTreatment(
  targetCase: string,
  treatments: TreatmentRecord[],
): TreatmentSummary {
  const relevant = treatments.filter((t) => t.targetCase === targetCase);
  const counts = ZERO_COUNTS();
  for (const t of relevant) {
    counts[t.label]++;
  }

  const negativeSignals: TreatmentSummary['negativeSignals'] = relevant
    .filter((t) =>
      t.label === 'reversed' ||
      t.label === 'overruled' ||
      t.label === 'criticized' ||
      t.label === 'distinguished',
    )
    .map((t) => ({
      citingCase: t.citingCase,
      citingCaseName: t.citingCaseName,
      paragraph: t.paragraph,
      label: t.label,
      citingCourtLevel: courtLevelFromCitation(t.citingCase),
      evidenceQuote: t.evidenceQuote,
    }));

  if (relevant.length === 0) {
    return {
      targetCase,
      status: 'unknown',
      statusBasis: 'No treatment data — case was not put through the TreatmentClassifier.',
      counts,
      negativeSignals: [],
    };
  }

  const reversedSignals = negativeSignals.filter((s) => s.label === 'reversed');
  if (reversedSignals.length > 0) {
    const apex = reversedSignals.find((s) => s.citingCourtLevel === 'apex');
    const appellate = reversedSignals.find((s) => s.citingCourtLevel === 'appellate');
    const driver = apex ?? appellate ?? reversedSignals[0]!;
    return {
      targetCase,
      status: 'reversed',
      statusBasis: `Reversed on appeal in ${driver.citingCase}${driver.citingCaseName ? ` (${driver.citingCaseName})` : ''} at para ${driver.paragraph}.`,
      counts,
      negativeSignals,
    };
  }

  const overruledSignals = negativeSignals.filter((s) => s.label === 'overruled');
  if (overruledSignals.length > 0) {
    const apex = overruledSignals.find((s) => s.citingCourtLevel === 'apex');
    const driver = apex ?? overruledSignals[0]!;
    return {
      targetCase,
      status: 'overruled',
      statusBasis: `Overruled in ${driver.citingCase}${driver.citingCaseName ? ` (${driver.citingCaseName})` : ''} at para ${driver.paragraph}.`,
      counts,
      negativeSignals,
    };
  }

  const criticisms = negativeSignals.filter((s) => s.label === 'criticized');
  const appellateCriticism = criticisms.find(
    (s) => s.citingCourtLevel === 'apex' || s.citingCourtLevel === 'appellate',
  );
  if (appellateCriticism) {
    return {
      targetCase,
      status: 'questioned',
      statusBasis: `Criticized at the appellate level in ${appellateCriticism.citingCase}${appellateCriticism.citingCaseName ? ` (${appellateCriticism.citingCaseName})` : ''} at para ${appellateCriticism.paragraph}.`,
      counts,
      negativeSignals,
    };
  }
  if (criticisms.length >= 2) {
    return {
      targetCase,
      status: 'questioned',
      statusBasis: `Multiple trial-level criticisms (${criticisms.length}); reasoning has been resisted in subsequent cases.`,
      counts,
      negativeSignals,
    };
  }

  const positives = counts.followed + counts.applied;
  const distinguishings = counts.distinguished;
  const basisParts: string[] = [];
  if (positives > 0) basisParts.push(`${positives} positive (followed/applied)`);
  if (distinguishings > 0) basisParts.push(`${distinguishings} distinguished`);
  if (counts.criticized > 0) basisParts.push(`${counts.criticized} criticized (trial-level only)`);
  if (counts.neutral > 0) basisParts.push(`${counts.neutral} neutral`);
  return {
    targetCase,
    status: 'good_law',
    statusBasis:
      basisParts.length > 0
        ? `Treatment so far: ${basisParts.join(', ')}.`
        : 'No engagement found in citing cases; treated as good law by default.',
    counts,
    negativeSignals,
  };
}
