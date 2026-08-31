import { describe, it, expect } from 'vitest';
import { parseSearchQuery } from '../src/utils/search';

describe('parseSearchQuery', () => {
  it('parses plain keywords', () => {
    const r = parseSearchQuery('react tutorial');
    expect(r.keyword).toBe('react tutorial');
    expect(r.maxResults).toBe(1000);
  });

  it('parses site: filter and extracts main domain', () => {
    const r = parseSearchQuery('site:github.com react');
    expect(r.domains).toEqual(['github.com']);
    expect(r.keyword).toBe('react');
  });

  it('parses site: with www input', () => {
    const r = parseSearchQuery('site:www.github.com');
    expect(r.domains).toEqual(['github.com']);
  });

  it('accumulates multiple site: filters instead of keeping only the last', () => {
    const r = parseSearchQuery('site:github.com site:stackoverflow.com react');
    expect(r.domains).toEqual(['github.com', 'stackoverflow.com']);
    expect(r.keyword).toBe('react');
  });

  it('drops an empty site: operator instead of matching everything', () => {
    const r = parseSearchQuery('site:');
    expect(r.domains).toBeUndefined();
  });

  it('parses before: date', () => {
    const r = parseSearchQuery('before:2024-06-01');
    expect(r.dateRange).toBeDefined();
    expect(r.dateRange!.end).toBe(new Date('2024-06-01T23:59:59').getTime());
  });

  it('parses after: date', () => {
    const r = parseSearchQuery('after:2024-01-01');
    expect(r.dateRange).toBeDefined();
    expect(r.dateRange!.start).toBe(new Date('2024-01-01T00:00:00').getTime());
  });

  it('combines before: and after:', () => {
    const r = parseSearchQuery('before:2024-06-01 after:2024-01-01');
    expect(r.dateRange!.start).toBe(new Date('2024-01-01T00:00:00').getTime());
    expect(r.dateRange!.end).toBe(new Date('2024-06-01T23:59:59').getTime());
  });

  it('handles empty/whitespace queries', () => {
    const r = parseSearchQuery('   ');
    expect(r.keyword).toBeUndefined();
    expect(r.domains).toBeUndefined();
    expect(r.maxResults).toBe(1000);
  });

  it('ignores invalid dates (operator dropped, no keyword pollution)', () => {
    const r = parseSearchQuery('before:not-a-date');
    expect(r.dateRange).toBeUndefined();
    expect(r.keyword).toBeUndefined();
  });

  it('is case-insensitive for operators', () => {
    const r = parseSearchQuery('SITE:example.com');
    expect(r.domains).toEqual(['example.com']);
  });
});
