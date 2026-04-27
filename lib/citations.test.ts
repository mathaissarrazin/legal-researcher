import { describe, it, expect } from 'vitest';
import { extractCitations } from './citations.js';

describe('extractCitations', () => {
  it('extracts a plain SCC neutral citation', () => {
    const result = extractCitations('See Bhasin v. Hrynew, 2014 SCC 71.');
    expect(result).toEqual([{ citation: '2014 SCC 71', type: 'neutral' }]);
  });

  it('extracts an ONCA neutral citation', () => {
    const result = extractCitations('Bak v. Dobell, 2007 ONCA 304, governs.');
    expect(result).toEqual([{ citation: '2007 ONCA 304', type: 'neutral' }]);
  });

  it('extracts a BCCA neutral citation', () => {
    const result = extractCitations('In Hartshorne v. Hartshorne, 2002 BCCA 16, the court held...');
    expect(result).toEqual([{ citation: '2002 BCCA 16', type: 'neutral' }]);
  });

  it('captures pinpoint after "at para"', () => {
    const result = extractCitations('Bhasin v. Hrynew, 2014 SCC 71 at para 33, established...');
    expect(result).toEqual([{ citation: '2014 SCC 71', type: 'neutral', pinpoint: '33' }]);
  });

  it('captures pinpoint after "at paras"', () => {
    const result = extractCitations('See 2014 SCC 71 at paras 33-35.');
    expect(result).toEqual([{ citation: '2014 SCC 71', type: 'neutral', pinpoint: '33-35' }]);
  });

  it('captures pinpoint with en-dash', () => {
    const result = extractCitations('See 2014 SCC 71 at paras 33–35.');
    expect(result[0].pinpoint).toBe('33–35');
  });

  it('captures pinpoint after "at paragraph"', () => {
    const result = extractCitations('2014 SCC 71 at paragraph 73.');
    expect(result).toEqual([{ citation: '2014 SCC 71', type: 'neutral', pinpoint: '73' }]);
  });

  it('captures pinpoint after "at paragraphs"', () => {
    const result = extractCitations('See 2014 SCC 71 at paragraphs 33-35.');
    expect(result[0].pinpoint).toBe('33-35');
  });

  it('extracts a traditional SCR citation', () => {
    const result = extractCitations('R. v. Sharpe, [2001] 1 SCR 45, applied here.');
    const types = result.map((r) => r.type);
    expect(types).toContain('traditional');
    expect(result.some((r) => r.citation.includes('[2001]'))).toBe(true);
  });

  it('extracts multiple citations from one passage', () => {
    const text = 'Bhasin v. Hrynew, 2014 SCC 71, refined in Wastech Services, 2021 SCC 7, and applied in 2020 SCC 45.';
    const result = extractCitations(text);
    const citations = result.map((r) => r.citation);
    expect(citations).toContain('2014 SCC 71');
    expect(citations).toContain('2021 SCC 7');
    expect(citations).toContain('2020 SCC 45');
  });

  it('extracts FCA citation', () => {
    const result = extractCitations('In Canada v. Smith, 2019 FCA 100, the court...');
    expect(result.map((r) => r.citation)).toContain('2019 FCA 100');
  });

  it('extracts FC citation', () => {
    const result = extractCitations('See 2018 FC 250.');
    expect(result.map((r) => r.citation)).toContain('2018 FC 250');
  });

  it('extracts TCC citation', () => {
    const result = extractCitations('In Smith v. R., 2020 TCC 5, the Tax Court...');
    expect(result.map((r) => r.citation)).toContain('2020 TCC 5');
  });

  it('extracts BCSC citation', () => {
    const result = extractCitations('In Doe v. Roe, 2022 BCSC 1234, ...');
    expect(result.map((r) => r.citation)).toContain('2022 BCSC 1234');
  });

  it('extracts NSSC citation', () => {
    const result = extractCitations('See 2015 NSSC 100.');
    expect(result.map((r) => r.citation)).toContain('2015 NSSC 100');
  });

  it('extracts RAD citation', () => {
    const result = extractCitations('See 2021 RAD 50 for credibility framework.');
    expect(result.map((r) => r.citation)).toContain('2021 RAD 50');
  });

  it('does NOT match "section 71 of the Act"', () => {
    const result = extractCitations('section 71 of the Act says X');
    expect(result.length).toBe(0);
  });

  it('does NOT match a year alone', () => {
    const result = extractCitations('In 2014 the parties contracted.');
    expect(result.length).toBe(0);
  });

  it('does NOT match "SCC justice"', () => {
    const result = extractCitations('The SCC justice wrote dissenting reasons.');
    expect(result.length).toBe(0);
  });

  it('handles citation followed by punctuation', () => {
    const result = extractCitations('See 2014 SCC 71; 2021 SCC 7.');
    expect(result.map((r) => r.citation)).toContain('2014 SCC 71');
    expect(result.map((r) => r.citation)).toContain('2021 SCC 7');
  });

  it('dedupes citations with same pinpoint', () => {
    const result = extractCitations('See 2014 SCC 71 at para 33. As 2014 SCC 71 at para 33 says...');
    expect(result.length).toBe(1);
  });

  it('treats different pinpoints on same citation as separate entries', () => {
    const text = '2014 SCC 71 at para 33 establishes... 2014 SCC 71 at para 73 refines...';
    const result = extractCitations(text);
    expect(result.length).toBe(2);
    const pinpoints = result.map((r) => r.pinpoint);
    expect(pinpoints).toContain('33');
    expect(pinpoints).toContain('73');
  });

  it('handles citations across line breaks', () => {
    const text = 'See Bhasin v. Hrynew,\n2014 SCC 71\nat para 33.';
    const result = extractCitations(text);
    expect(result.map((r) => r.citation)).toContain('2014 SCC 71');
  });

  it('extracts CHRT (tribunal) citation', () => {
    const result = extractCitations('See 2019 CHRT 11.');
    expect(result.map((r) => r.citation)).toContain('2019 CHRT 11');
  });
});
