import { describe, it, expect } from 'vitest';
import { extractParagraph, verifyQuote } from './verify.js';

describe('extractParagraph', () => {
  const sample = `Heading\n[1] First paragraph text.\n[2] Second paragraph text.\n[33] Important paragraph that says incremental steps matter.\n[34] Next paragraph.\n`;

  it('extracts paragraph 33 cleanly', () => {
    const result = extractParagraph(sample, 33);
    expect(result).not.toBeNull();
    expect(result).toContain('Important paragraph');
    expect(result).toContain('incremental steps');
  });

  it('extracts paragraph 1', () => {
    const result = extractParagraph(sample, 1);
    expect(result).toContain('First paragraph');
  });

  it('returns null for missing paragraph', () => {
    expect(extractParagraph(sample, 999)).toBeNull();
  });

  it('extracts paragraph and stops before next marker', () => {
    const result = extractParagraph(sample, 2);
    expect(result).toContain('Second paragraph');
    expect(result).not.toContain('Important paragraph');
  });
});

describe('verifyQuote', () => {
  it('matches exact substring', () => {
    expect(verifyQuote('hello world foo bar', 'world foo')).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(verifyQuote('Hello World', 'hello world')).toBe(true);
  });

  it('matches across whitespace differences', () => {
    expect(verifyQuote('hello\n\nworld   foo', 'hello world foo')).toBe(true);
  });

  it('rejects non-substring', () => {
    expect(verifyQuote('hello world', 'goodbye')).toBe(false);
  });

  it('matches identical strings', () => {
    expect(verifyQuote('the duty of honest performance', 'the duty of honest performance')).toBe(true);
  });

  it('matches a quote with leading/trailing whitespace differences', () => {
    expect(verifyQuote('  hello  world  ', 'hello world')).toBe(true);
  });
});

describe('verify integration (skipped unless A2AJ_INTEGRATION=1)', () => {
  it.skipIf(!process.env.A2AJ_INTEGRATION)(
    'verifies a known Bhasin paragraph against the live A2AJ',
    async () => {
      const { fetchCase } = await import('./a2aj.js');
      const result = await fetchCase('2014 SCC 71');
      expect(result).not.toBeNull();
      const text = result!.unofficial_text_en!;
      const para = extractParagraph(text, 33);
      expect(para).not.toBeNull();
      expect(verifyQuote(para!, 'incremental steps')).toBe(true);
    },
    20_000,
  );
});
