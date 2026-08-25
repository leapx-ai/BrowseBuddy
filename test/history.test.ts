import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchAllHistory, calculateStatistics, exportToCsv, exportToHtml, getAllDomains } from '../src/utils/history';
import type { HistoryItem, Statistics } from '../src/types';

const BASE_TS = new Date('2026-01-10T00:00:00Z').getTime();

// Helper to build a fake history dataset
function buildItems(count: number, startTs: number, stepMs: number): HistoryItem[] {
  const items: HistoryItem[] = [];
  for (let i = 0; i < count; i++) {
    const ts = startTs - i * stepMs;
    items.push({
      id: `${i}`,
      url: `https://site${i % 5}.com/page${i}`,
      title: `Page ${i}`,
      visitTime: ts,
      visitCount: 1,
      lastVisitTime: ts,
    });
  }
  return items;
}

// Mock chrome.history.search to simulate Chrome's behavior:
// returns up to maxResults items sorted by lastVisitTime DESC, filtered by endTime (exclusive).
function mockHistorySearch(items: HistoryItem[]) {
  const sorted = [...items].sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0));
  (globalThis as unknown as { chrome: { history: { search: unknown } } }).chrome.history.search = vi.fn(
    (query: chrome.history.HistoryQuery, cb: (r: chrome.history.HistoryItem[]) => void) => {
      let result = sorted;
      if (query.endTime !== undefined) {
        result = result.filter(i => (i.lastVisitTime || 0) < (query.endTime as number));
      }
      if (query.startTime !== undefined) {
        result = result.filter(i => (i.lastVisitTime || 0) >= (query.startTime as number));
      }
      result = result.slice(0, query.maxResults);
      cb(result);
    }
  );
}

describe('fetchAllHistory pagination', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches ALL records beyond a single query limit without loss', async () => {
    // 12000 records spanning 30 days (400/day)
    const items = buildItems(12000, BASE_TS, 1000);
    mockHistorySearch(items);

    const all = await fetchAllHistory({ maxResults: 20000 });
    expect(all).toHaveLength(12000);
    // Verify all URLs present (dedup keys are url:timestamp, all unique here)
    const urls = new Set(all.map(i => i.url));
    expect(urls.size).toBe(12000);
  });

  it('does not exceed the requested maxResults', async () => {
    const items = buildItems(12000, BASE_TS, 1000);
    mockHistorySearch(items);

    const all = await fetchAllHistory({ maxResults: 5000 });
    expect(all).toHaveLength(5000);
  });

  it('respects a date range end', async () => {
    const items = buildItems(100, BASE_TS, 1000);
    mockHistorySearch(items);
    const end = BASE_TS - 50 * 1000;

    const all = await fetchAllHistory({ dateRange: { start: 0, end } });
    expect(all.every(i => (i.lastVisitTime || 0) < end)).toBe(true);
    // items are at BASE_TS - i*1000. end = BASE_TS - 50000.
    // i*1000 > 50000 => i > 50 => items 51..99 = 49 records (exclusive end).
    expect(all).toHaveLength(49);
  });

  it('deduplicates records with identical url+timestamp', async () => {
    const items = buildItems(100, BASE_TS, 1000);
    // Add duplicates
    const dup = { ...items[0] };
    items.push(dup, { ...dup });
    mockHistorySearch(items);

    const all = await fetchAllHistory({ maxResults: 20000 });
    // 100 unique + 2 dups of items[0] -> should dedupe to 100 unique
    expect(all).toHaveLength(100);
  });

  it('terminates when history is empty', async () => {
    mockHistorySearch([]);
    const all = await fetchAllHistory();
    expect(all).toHaveLength(0);
  });
});

describe('calculateStatistics', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('aggregates top sites by main domain (www and bare merge)', async () => {
    const now = BASE_TS;
    const items: HistoryItem[] = [
      { id: '1', url: 'https://www.example.com/a', title: 'a', visitTime: now - 1000, visitCount: 1, lastVisitTime: now - 1000 },
      { id: '2', url: 'https://example.com/b', title: 'b', visitTime: now - 2000, visitCount: 1, lastVisitTime: now - 2000 },
      { id: '3', url: 'https://other.com/c', title: 'c', visitTime: now - 3000, visitCount: 1, lastVisitTime: now - 3000 },
    ];
    mockHistorySearch(items);

    const stats = await calculateStatistics([]);
    expect(stats.totalRecords).toBe(3);
    expect(stats.totalDomains).toBe(2);
    const example = stats.topSites.find(s => s.domain === 'example.com');
    expect(example?.count).toBe(2);
  });

  it('zero-fills days with no visits in dailyStats', async () => {
    // Use timestamps well in the past so Date.now() endTime never clips them.
    const end = new Date('2026-01-05T12:00:00Z').getTime();
    const start = new Date('2026-01-01T12:00:00Z').getTime();
    const items: HistoryItem[] = [
      { id: '1', url: 'https://a.com', title: 'a', visitTime: start, visitCount: 1, lastVisitTime: start },
      { id: '2', url: 'https://b.com', title: 'b', visitTime: end, visitCount: 1, lastVisitTime: end },
    ];
    mockHistorySearch(items);

    const stats = await calculateStatistics([]);
    // Jan 1 -> Jan 5 = 5 calendar days, with zero-filled gaps
    expect(stats.dailyStats.length).toBe(5);
    expect(stats.dailyStats[0].count).toBe(1); // Jan 1
    expect(stats.dailyStats[1].count).toBe(0); // Jan 2
    expect(stats.dailyStats[4].count).toBe(1); // Jan 5
  });

  it('filters blacklisted domains from stats', async () => {
    const now = BASE_TS;
    const items: HistoryItem[] = [
      { id: '1', url: 'https://blocked.com/a', title: 'a', visitTime: now - 1000, visitCount: 1, lastVisitTime: now - 1000 },
      { id: '2', url: 'https://ok.com/b', title: 'b', visitTime: now - 2000, visitCount: 1, lastVisitTime: now - 2000 },
    ];
    mockHistorySearch(items);

    const blacklist = [{ id: '1', pattern: 'blocked.com', type: 'exact' as const, enabled: true, createdAt: 1 }];
    const stats = await calculateStatistics(blacklist);
    expect(stats.totalRecords).toBe(1);
    expect(stats.topSites[0].domain).toBe('ok.com');
  });

  it('returns empty defaults when no items', async () => {
    mockHistorySearch([]);
    const stats = await calculateStatistics([]);
    expect(stats.totalRecords).toBe(0);
    expect(stats.dailyStats).toEqual([]);
    expect(stats.dateRange).toEqual({ earliest: 0, latest: 0 });
  });
});

describe('getAllDomains', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns unique main domains sorted', async () => {
    const now = BASE_TS;
    const items: HistoryItem[] = [
      { id: '1', url: 'https://www.example.com/a', title: 'a', visitTime: now - 1000, visitCount: 1, lastVisitTime: now - 1000 },
      { id: '2', url: 'https://example.com/b', title: 'b', visitTime: now - 2000, visitCount: 1, lastVisitTime: now - 2000 },
      { id: '3', url: 'https://zed.com/c', title: 'c', visitTime: now - 3000, visitCount: 1, lastVisitTime: now - 3000 },
    ];
    mockHistorySearch(items);

    const domains = await getAllDomains();
    expect(domains).toEqual(['example.com', 'zed.com']);
  });
});

describe('exportToCsv', () => {
  it('escapes quotes in titles', () => {
    const csv = exportToCsv([
      { id: '1', url: 'https://a.com', title: 'He said "hi"', visitTime: 0, visitCount: 2 },
    ]);
    expect(csv).toContain('He said ""hi""');
    expect(csv.split('\n')[0]).toBe('Title,URL,Visit Time,Visit Count');
  });

  it('produces a header row and one row per item', () => {
    const csv = exportToCsv([
      { id: '1', url: 'https://a.com', title: 'A', visitTime: 0, visitCount: 1 },
      { id: '2', url: 'https://b.com', title: 'B', visitTime: 0, visitCount: 1 },
    ]);
    expect(csv.split('\n')).toHaveLength(3);
  });

  it('escapes quotes in urls too', () => {
    const csv = exportToCsv([
      { id: '1', url: 'https://a.com/?q="x"', title: 'A', visitTime: 0, visitCount: 1 },
    ]);
    // An unescaped quote ended the field early and shifted every later column.
    expect(csv).toContain('"https://a.com/?q=""x"""');
    expect(csv.split('\n')[1].split('","')).toHaveLength(2);
  });
});

describe('exportToHtml escaping', () => {
  const stats: Statistics = {
    totalRecords: 1,
    totalDomains: 1,
    dateRange: { earliest: 0, latest: 0 },
    topSites: [{ domain: '<img src=x onerror=alert(1)>', count: 1, lastVisit: 0 }],
    timeDistribution: [],
    dailyStats: [],
  };

  it('escapes titles and urls from page content', () => {
    const html = exportToHtml(
      [
        {
          id: '1',
          url: 'https://evil.test/?<script>alert(1)</script>',
          title: '<script>alert("xss")</script>',
          visitTime: Date.parse('2026-08-25T10:00:00Z'),
          visitCount: 1,
        },
      ],
      stats
    );

    // A page controls its own title, and the report is opened as a local file,
    // so a raw title used to run as script with that file's origin.
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes domain names in the top-sites and duration lists', () => {
    const html = exportToHtml([], stats, { '<b>evil.test</b>': 5000 });

    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;b&gt;evil.test&lt;/b&gt;');
  });
});
