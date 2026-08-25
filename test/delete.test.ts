import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchAllHistory, previewDelete, deleteHistory } from '../src/utils/history';
import { hostMatchesDomain } from '../src/utils/blacklist';
import type { HistoryItem } from '../src/types';

const BASE_TS = new Date('2026-01-10T00:00:00Z').getTime();

type Visit = { url: string; visitTime: number };

// Mock chrome.history.search the way Chrome behaves: newest first, endTime
// exclusive, truncated to maxResults.
function mockSearch(items: HistoryItem[]) {
  const sorted = [...items].sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0));
  chrome.history.search = vi.fn(
    (query: chrome.history.HistoryQuery, cb: (r: chrome.history.HistoryItem[]) => void) => {
      let result = sorted;
      if (query.endTime !== undefined) {
        result = result.filter(i => (i.lastVisitTime || 0) < (query.endTime as number));
      }
      if (query.startTime !== undefined) {
        result = result.filter(i => (i.lastVisitTime || 0) >= (query.startTime as number));
      }
      cb(result.slice(0, query.maxResults) as chrome.history.HistoryItem[]);
    }
  ) as unknown as typeof chrome.history.search;
}

// Records every deletion call so tests can assert on the blast radius.
function mockDeletions(visits: Visit[] = []) {
  const deletedUrls: string[] = [];
  const deletedRanges: Array<{ startTime: number; endTime: number }> = [];

  chrome.history.deleteUrl = vi.fn((details: { url: string }, cb?: () => void) => {
    deletedUrls.push(details.url);
    cb?.();
  }) as unknown as typeof chrome.history.deleteUrl;

  chrome.history.deleteRange = vi.fn(
    (range: { startTime: number; endTime: number }, cb?: () => void) => {
      deletedRanges.push(range);
      cb?.();
    }
  ) as unknown as typeof chrome.history.deleteRange;

  chrome.history.getVisits = vi.fn(async (details: { url: string }) =>
    visits.filter(v => v.url === details.url).map(v => ({ visitTime: v.visitTime }))
  ) as unknown as typeof chrome.history.getVisits;

  return { deletedUrls, deletedRanges };
}

function item(url: string, ts: number): HistoryItem {
  return { id: url, url, title: url, visitTime: ts, visitCount: 1, lastVisitTime: ts };
}

describe('hostMatchesDomain', () => {
  it('matches the domain itself and its subdomains', () => {
    expect(hostMatchesDomain('example.com', 'example.com')).toBe(true);
    expect(hostMatchesDomain('a.b.example.com', 'example.com')).toBe(true);
  });

  it('rejects substring lookalikes', () => {
    expect(hostMatchesDomain('latest.com', 'test.com')).toBe(false);
    expect(hostMatchesDomain('notexample.com', 'example.com')).toBe(false);
    expect(hostMatchesDomain('example.com.evil.tld', 'example.com')).toBe(false);
  });

  it('ignores a trailing root label and letter case', () => {
    expect(hostMatchesDomain('example.com.', 'example.com')).toBe(true);
    expect(hostMatchesDomain('EXAMPLE.COM', 'example.com')).toBe(true);
  });

  it('never matches on an empty domain', () => {
    expect(hostMatchesDomain('example.com', '')).toBe(false);
  });
});

describe('previewDelete scoping', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockDeletions();
  });

  it('returns only the requested domain, not the whole history', async () => {
    mockSearch([
      item('https://example.com/a', BASE_TS),
      item('https://sub.example.com/b', BASE_TS - 1000),
      item('https://unrelated.com/c', BASE_TS - 2000),
      item('https://notexample.com/d', BASE_TS - 3000),
    ]);

    const preview = await previewDelete({ domain: 'example.com' });

    expect(preview.map(i => i.url).sort()).toEqual([
      'https://example.com/a',
      'https://sub.example.com/b',
    ]);
  });

  it('does not pull in substring lookalikes', async () => {
    mockSearch([
      item('https://test.com/a', BASE_TS),
      item('https://latest.com/b', BASE_TS - 1000),
      item('https://contest.com/c', BASE_TS - 2000),
    ]);

    const preview = await previewDelete({ domain: 'test.com' });

    expect(preview.map(i => i.url)).toEqual(['https://test.com/a']);
  });

  it('refuses an options object with no criteria', async () => {
    mockSearch([item('https://example.com/a', BASE_TS)]);

    await expect(previewDelete({})).rejects.toThrow(/no delete criteria/i);
  });

  it('treats an unparseable domain as no criteria rather than everything', async () => {
    mockSearch([
      item('https://example.com/a', BASE_TS),
      item('https://unrelated.com/b', BASE_TS - 1000),
    ]);

    await expect(previewDelete({ domain: '' })).rejects.toThrow(/no delete criteria/i);
  });
});

describe('fetchAllHistory with a domain filter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps paginating past pages where nothing matches', async () => {
    // 5000 filler records newer than the 10 records we actually want. The first
    // two 2000-record pages contain zero matches, which used to look like
    // "end of history" and truncated the result to nothing.
    const items: HistoryItem[] = [];
    for (let i = 0; i < 5000; i++) {
      items.push(item(`https://filler.com/page${i}`, BASE_TS - i * 1000));
    }
    for (let i = 0; i < 10; i++) {
      items.push(item(`https://target.com/page${i}`, BASE_TS - (5000 + i) * 1000));
    }
    mockSearch(items);

    const result = await fetchAllHistory({ domains: ['target.com'], maxResults: 20000 });

    expect(result).toHaveLength(10);
    expect(result.every(i => i.url.startsWith('https://target.com/'))).toBe(true);
  });
});

describe('deleteHistory', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('deletes exactly the items it was handed, and nothing else', async () => {
    const { deletedUrls } = mockDeletions();
    // A record that exists in history but was not previewed must survive.
    mockSearch([
      item('https://a.com/1', BASE_TS),
      item('https://b.com/2', BASE_TS - 1000),
      item('https://recorded-after-preview.com/3', BASE_TS - 2000),
    ]);

    const previewed = [item('https://a.com/1', BASE_TS), item('https://b.com/2', BASE_TS - 1000)];
    const count = await deleteHistory(previewed);

    expect(count).toBe(2);
    expect(deletedUrls).toEqual(['https://a.com/1', 'https://b.com/2']);
  });

  it('without a date range, removes the URL outright', async () => {
    const { deletedUrls, deletedRanges } = mockDeletions();

    await deleteHistory([item('https://a.com/1', BASE_TS)]);

    expect(deletedUrls).toEqual(['https://a.com/1']);
    expect(deletedRanges).toEqual([]);
  });

  it('with a date range, leaves visits outside the range alone', async () => {
    const inside = BASE_TS;
    const outside = BASE_TS - 90 * 24 * 60 * 60 * 1000;
    const { deletedUrls, deletedRanges } = mockDeletions([
      { url: 'https://news.tld/', visitTime: inside },
      { url: 'https://news.tld/', visitTime: outside },
    ]);

    const count = await deleteHistory([item('https://news.tld/', inside)], {
      start: BASE_TS - 1000,
      end: BASE_TS + 1000,
    });

    expect(count).toBe(1);
    // deleteUrl would have erased the 90-day-old visit too.
    expect(deletedUrls).toEqual([]);
    expect(deletedRanges).toEqual([{ startTime: inside - 1, endTime: inside + 1 }]);
  });

  it('collapses to a single call when every visit is inside the range', async () => {
    const { deletedUrls, deletedRanges } = mockDeletions([
      { url: 'https://a.com/1', visitTime: BASE_TS },
      { url: 'https://a.com/1', visitTime: BASE_TS - 500 },
    ]);

    await deleteHistory([item('https://a.com/1', BASE_TS)], {
      start: BASE_TS - 1000,
      end: BASE_TS + 1000,
    });

    expect(deletedUrls).toEqual(['https://a.com/1']);
    expect(deletedRanges).toEqual([]);
  });

  it('skips a URL whose visits all fall outside the range', async () => {
    const { deletedUrls, deletedRanges } = mockDeletions([
      { url: 'https://a.com/1', visitTime: BASE_TS - 90 * 24 * 60 * 60 * 1000 },
    ]);

    await deleteHistory([item('https://a.com/1', BASE_TS)], {
      start: BASE_TS - 1000,
      end: BASE_TS + 1000,
    });

    expect(deletedUrls).toEqual([]);
    expect(deletedRanges).toEqual([]);
  });
});
