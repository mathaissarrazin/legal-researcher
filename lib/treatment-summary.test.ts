import { describe, it, expect } from 'vitest';
import {
  courtLevelFromCitation,
  summarizeTreatment,
  type TreatmentRecord,
} from './treatment-summary.js';

const target = '2014 SCC 71';

function record(
  label: TreatmentRecord['label'],
  citingCase: string,
  citingCaseName?: string,
): TreatmentRecord {
  return {
    targetCase: target,
    citingCase,
    citingCaseName,
    paragraph: 1,
    label,
    evidenceQuote: 'q',
  };
}

describe('courtLevelFromCitation', () => {
  it('classifies apex courts', () => {
    expect(courtLevelFromCitation('2021 SCC 7')).toBe('apex');
  });
  it('classifies appellate courts', () => {
    expect(courtLevelFromCitation('2022 BCCA 264')).toBe('appellate');
    expect(courtLevelFromCitation('2018 ONCA 100')).toBe('appellate');
    expect(courtLevelFromCitation('2020 FCA 50')).toBe('appellate');
  });
  it('classifies trial courts', () => {
    expect(courtLevelFromCitation('2024 BCSC 458')).toBe('trial');
    expect(courtLevelFromCitation('2023 ABKB 12')).toBe('trial');
  });
  it('classifies tribunals', () => {
    expect(courtLevelFromCitation('2022 CHRT 5')).toBe('tribunal');
  });
  it('returns unknown for malformed citations', () => {
    expect(courtLevelFromCitation('not a citation')).toBe('unknown');
    expect(courtLevelFromCitation('[2014] 3 SCR 494')).toBe('unknown');
  });
});

describe('summarizeTreatment', () => {
  it('returns unknown when no treatments are provided', () => {
    const s = summarizeTreatment(target, []);
    expect(s.status).toBe('unknown');
    expect(s.counts.followed).toBe(0);
  });

  it('returns good_law when only positive treatments exist', () => {
    const s = summarizeTreatment(target, [
      record('followed', '2021 SCC 7', 'Wastech'),
      record('applied', '2022 BCCA 100'),
    ]);
    expect(s.status).toBe('good_law');
    expect(s.counts.followed).toBe(1);
    expect(s.counts.applied).toBe(1);
    expect(s.negativeSignals).toHaveLength(0);
  });

  it('returns good_law when only distinguished (no negative signals)', () => {
    const s = summarizeTreatment(target, [record('distinguished', '2023 BCSC 200')]);
    expect(s.status).toBe('good_law');
    expect(s.statusBasis).toContain('distinguished');
  });

  it('returns reversed when an appellate court reversed the proceeding', () => {
    const s = summarizeTreatment(target, [
      record('followed', '2021 SCC 7'),
      record('reversed', '2015 SCC 50', 'Same Parties on appeal'),
    ]);
    expect(s.status).toBe('reversed');
    expect(s.statusBasis).toContain('2015 SCC 50');
    expect(s.negativeSignals.some((n) => n.label === 'reversed')).toBe(true);
  });

  it('returns overruled when a citing court overruled the rule', () => {
    const s = summarizeTreatment(target, [record('overruled', '2025 SCC 5')]);
    expect(s.status).toBe('overruled');
    expect(s.statusBasis).toContain('2025 SCC 5');
  });

  it('reversed dominates overruled if both present', () => {
    const s = summarizeTreatment(target, [
      record('reversed', '2015 SCC 50'),
      record('overruled', '2025 SCC 5'),
    ]);
    expect(s.status).toBe('reversed');
  });

  it('returns questioned when an appellate court criticized', () => {
    const s = summarizeTreatment(target, [
      record('followed', '2018 BCSC 1'),
      record('criticized', '2022 BCCA 264'),
    ]);
    expect(s.status).toBe('questioned');
    expect(s.statusBasis).toContain('appellate');
  });

  it('returns questioned on multiple trial-level criticisms', () => {
    const s = summarizeTreatment(target, [
      record('criticized', '2020 BCSC 1'),
      record('criticized', '2021 ONSC 5'),
    ]);
    expect(s.status).toBe('questioned');
    expect(s.statusBasis).toContain('trial-level');
  });

  it('does NOT downgrade to questioned for a single trial-level criticism', () => {
    const s = summarizeTreatment(target, [
      record('followed', '2021 SCC 7'),
      record('criticized', '2020 BCSC 1'),
    ]);
    expect(s.status).toBe('good_law');
  });

  it('filters out treatments for other target cases', () => {
    const mixed: TreatmentRecord[] = [
      { ...record('overruled', '2025 SCC 5'), targetCase: 'OTHER 1234' },
      record('followed', '2021 SCC 7'),
    ];
    const s = summarizeTreatment(target, mixed);
    expect(s.status).toBe('good_law');
    expect(s.counts.overruled).toBe(0);
  });
});
