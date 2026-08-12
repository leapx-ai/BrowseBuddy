import type { SearchOptions } from '../types';
import { extractMainDomain } from './blacklist';

// Parse a query string into history search options.
// Supports: plain keywords, site:example.com, before:2024-01-01, after:2024-01-01
export function parseSearchQuery(query: string): SearchOptions {
  const options: SearchOptions = { maxResults: 1000 };
  const keywords: string[] = [];

  const tokens = query.trim().split(/\s+/).filter(Boolean);
  tokens.forEach(token => {
    const lower = token.toLowerCase();

    if (lower.startsWith('site:')) {
      const domain = extractMainDomain(token.slice(5));
      if (domain) {
        options.domains = [domain];
      }
    } else if (lower.startsWith('before:')) {
      const date = token.slice(7);
      const ts = new Date(date + 'T23:59:59').getTime();
      if (!isNaN(ts)) {
        options.dateRange = { ...(options.dateRange || { start: 0 }), end: ts };
      }
    } else if (lower.startsWith('after:')) {
      const date = token.slice(6);
      const ts = new Date(date + 'T00:00:00').getTime();
      if (!isNaN(ts)) {
        options.dateRange = { ...(options.dateRange || { end: Date.now() }), start: ts };
      }
    } else {
      keywords.push(token);
    }
  });

  if (keywords.length > 0) {
    options.keyword = keywords.join(' ');
  }

  return options;
}
