import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getCalendarData } from '../src/utils/history';
import {
  getVisibleDomainDurations,
  saveDomainDurations,
  getDomainDurations,
  addUrlToBlacklist,
  saveBlacklist,
  getBlacklist,
  getFavorites,
} from '../src/utils/storage';
import { isUrlBlacklisted } from '../src/utils/blacklist';
import type { BlacklistEntry, HistoryItem } from '../src/types';

function entry(pattern: string): BlacklistEntry {
  return { id: pattern, pattern, type: 'exact', enabled: true, createdAt: 0 };
}

// Fixtures are Chrome-shaped (lastVisitTime), matching what the API returns.
function mockSearch(items: chrome.history.HistoryItem[]) {
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
      cb(result.slice(0, query.maxResults));
    }
  ) as unknown as typeof chrome.history.search;
}

function visit(url: string, ts: number): chrome.history.HistoryItem {
  return { id: `${url}${ts}`, url, title: url, visitCount: 1, lastVisitTime: ts };
}

async function resetStorage() {
  await chrome.storage.local.set({
    browsebuddy_blacklist: undefined,
    browsebuddy_favorites: undefined,
    browsebuddy_durations: undefined,
  });
}

describe('blacklist matching', () => {
  it('is not bypassed by a trailing root label', () => {
    const list = [entry('example.com')];
    // new URL("https://example.com./").hostname keeps the dot, so the extracted
    // domain used to be "example.com." and never matched the stored pattern.
    expect(isUrlBlacklisted('https://example.com./', list)).toBe(true);
    expect(isUrlBlacklisted('https://sub.example.com./', list)).toBe(true);
  });

  it('still rejects unrelated hosts', () => {
    const list = [entry('example.com')];
    expect(isUrlBlacklisted('https://example.com.evil.tld/', list)).toBe(false);
    expect(isUrlBlacklisted('https://notexample.com/', list)).toBe(false);
  });
});

describe('getCalendarData', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await resetStorage();
  });

  it('excludes blacklisted domains from the heat map', async () => {
    const day = new Date(2026, 7, 12, 10, 0).getTime();
    mockSearch([
      visit('https://secret.tld/a', day),
      visit('https://secret.tld/b', day + 1000),
      visit('https://public.tld/c', day + 2000),
    ]);

    // The blacklist arrives as a parameter - history.ts no longer reads
    // storage itself, so the test hands the list over directly.
    const data = await getCalendarData(2026, 7, [entry('secret.tld')]);

    expect(data).toEqual([{ date: '2026-08-12', count: 1, intensity: 1 }]);
  });

  it('keys cells by the local calendar date, not the UTC one', async () => {
    // Both edges of a local day. Whatever the machine's offset, at least one of
    // these resolves to a different UTC date, which is what used to move the
    // visit into the neighbouring cell.
    const early = new Date(2026, 7, 12, 0, 30).getTime();
    const late = new Date(2026, 7, 12, 23, 30).getTime();
    mockSearch([visit('https://a.tld/1', early), visit('https://a.tld/2', late)]);

    const data = await getCalendarData(2026, 7, []);

    expect(data).toEqual([{ date: '2026-08-12', count: 2, intensity: 1 }]);
  });

  it('includes visits on the last day of the month', async () => {
    // The range used to end at the last day 00:00, dropping that entire day.
    const lastDay = new Date(2026, 7, 31, 18, 0).getTime();
    mockSearch([visit('https://a.tld/1', lastDay)]);

    const data = await getCalendarData(2026, 7, []);

    expect(data).toEqual([{ date: '2026-08-31', count: 1, intensity: 1 }]);
  });
});

describe('dwell time and the blacklist', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await resetStorage();
  });

  it('hides blacklisted domains from the visible durations', async () => {
    await saveDomainDurations({ 'secret.tld': 7200000, 'public.tld': 60000 });
    await saveBlacklist([entry('secret.tld')]);

    const visible = await getVisibleDomainDurations();

    // The stats panel and the exported HTML report both read this.
    expect(visible).toEqual({ 'public.tld': 60000 });
    // The raw accessor still sees everything - the background worker needs it.
    expect(await getDomainDurations()).toHaveProperty('secret.tld');
  });

  it('purges a domain dwell time when it is blacklisted', async () => {
    await saveDomainDurations({ 'secret.tld': 7200000, 'public.tld': 60000 });
    chrome.history.search = vi.fn(
      (_q: chrome.history.HistoryQuery, cb: (r: chrome.history.HistoryItem[]) => void) => cb([])
    ) as unknown as typeof chrome.history.search;

    await addUrlToBlacklist('https://secret.tld/page', false);

    expect(await getDomainDurations()).toEqual({ 'public.tld': 60000 });
  });

  it('records the blacklist entry even when history is not deleted', async () => {
    chrome.history.search = vi.fn(
      (_q: chrome.history.HistoryQuery, cb: (r: chrome.history.HistoryItem[]) => void) => cb([])
    ) as unknown as typeof chrome.history.search;

    const { entry: added } = await addUrlToBlacklist('https://secret.tld/page', false);

    expect(added?.pattern).toBe('secret.tld');
    expect((await getBlacklist()).map(e => e.pattern)).toEqual(['secret.tld']);
  });
});

describe('protection lists fail closed', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await resetStorage();
  });

  it('propagates a blacklist read failure instead of reporting an empty list', async () => {
    const original = chrome.storage.local.get;
    chrome.storage.local.get = vi.fn(async () => {
      throw new Error('storage unavailable');
    }) as unknown as typeof chrome.storage.local.get;

    // Returning [] here used to mean "nothing is blacklisted", silently
    // disabling protection.
    await expect(getBlacklist()).rejects.toThrow('storage unavailable');
    await expect(getFavorites()).rejects.toThrow('storage unavailable');

    chrome.storage.local.get = original;
  });
});
