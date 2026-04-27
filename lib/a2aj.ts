// Thin REST client for the A2AJ Canadian Legal Data API.
// https://api.a2aj.ca

const BASE = 'https://api.a2aj.ca';

export interface A2AJFetchResult {
  dataset: string;
  citation_en?: string;
  citation2_en?: string;
  name_en?: string;
  document_date_en?: string;
  url_en?: string;
  unofficial_text_en?: string;
  upstream_license?: string;
  [key: string]: unknown;
}

export interface A2AJSearchHit {
  citation_en?: string;
  name_en?: string;
  dataset?: string;
  document_date_en?: string;
  snippet?: string;
  [key: string]: unknown;
}

export interface A2AJSearchResponse {
  results: A2AJSearchHit[];
}

export interface A2AJFetchResponse {
  results: A2AJFetchResult[];
}

export interface A2AJCoverageItem {
  dataset: string;
  description_en?: string | null;
  description_fr?: string | null;
  earliest_document_date?: string | null;
  latest_document_date?: string | null;
  number_of_documents: number;
}

export interface A2AJCoverageResponse {
  results: A2AJCoverageItem[];
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 2, backoffMs = 1000): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastErr;
}

export async function fetchCase(citation: string): Promise<A2AJFetchResult | null> {
  const url = new URL(`${BASE}/fetch`);
  url.searchParams.set('citation', citation);
  url.searchParams.set('doc_type', 'cases');

  const data = await withRetry(async () => {
    const res = await fetch(url.toString());
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`A2AJ fetch ${res.status}: ${await res.text()}`);
    return (await res.json()) as A2AJFetchResponse;
  });

  if (!data || !data.results || data.results.length === 0) return null;
  return data.results[0];
}

export async function searchCases(opts: {
  query: string;
  searchType?: 'full_text' | 'name';
  datasets?: string[];
  size?: number;
  startDate?: string;
  endDate?: string;
}): Promise<A2AJSearchResponse> {
  const url = new URL(`${BASE}/search`);
  url.searchParams.set('query', opts.query);
  url.searchParams.set('search_type', opts.searchType ?? 'full_text');
  url.searchParams.set('doc_type', 'cases');
  if (opts.size) url.searchParams.set('size', String(opts.size));
  if (opts.datasets && opts.datasets.length > 0) {
    url.searchParams.set('dataset', opts.datasets.join(','));
  }
  if (opts.startDate) url.searchParams.set('start_date', opts.startDate);
  if (opts.endDate) url.searchParams.set('end_date', opts.endDate);

  return withRetry(async () => {
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`A2AJ search ${res.status}: ${await res.text()}`);
    return (await res.json()) as A2AJSearchResponse;
  });
}

export async function coverage(docType: 'cases' | 'laws' = 'cases'): Promise<A2AJCoverageResponse> {
  const url = new URL(`${BASE}/coverage`);
  url.searchParams.set('doc_type', docType);
  return withRetry(async () => {
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`A2AJ coverage ${res.status}: ${await res.text()}`);
    return (await res.json()) as A2AJCoverageResponse;
  });
}
