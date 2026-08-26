import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  restoreBackup,
  createBackup,
  getBlacklist,
  getFavorites,
  addFavorite,
  removeFavorite,
  addUrlToBlacklist,
  saveBlacklist,
  updateBlacklistEntry,
  getSettings,
  saveSettings,
  saveDomainDurations,
  getVisibleDomainDurations,
  defaultSettings,
} from '../src/utils/storage';
import type { BlacklistEntry } from '../src/types';

function resetStorage() {
  const chrome = (globalThis as unknown as { chrome: any }).chrome;
  // Clear the underlying store by resetting via direct manipulation
  return chrome.storage.local.set({
    browsebuddy_settings: undefined,
    browsebuddy_blacklist: undefined,
    browsebuddy_favorites: undefined,
    browsebuddy_durations: undefined,
    browsebuddy_backup: undefined,
  }).then(() => {
    // re-run storage.clear semantics: our mock set() with undefined stores undefined;
    // get() returns undefined which utils treat as defaults. Good enough.
  });
}

describe('createBackup', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await resetStorage();
  });

  it('does not write a copy back into storage', async () => {
    await saveBlacklist([
      { id: '1', pattern: 'example.com', type: 'exact', enabled: true, createdAt: 0 },
    ] as BlacklistEntry[]);

    await createBackup();

    const stored = await chrome.storage.local.get('browsebuddy_backup');
    // Snapshotting get(null) into storage made every backup embed the previous
    // one, doubling the stored size until the quota was exhausted.
    expect(stored.browsebuddy_backup).toBeUndefined();
  });

  it('omits a snapshot left behind by an older version', async () => {
    await chrome.storage.local.set({
      browsebuddy_backup: { version: '1.0.0', data: { nested: 'legacy blob' } },
    });

    const json = await createBackup();

    expect(JSON.parse(json).data.browsebuddy_backup).toBeUndefined();
  });

  it('does not re-import a nested snapshot on restore', async () => {
    await restoreBackup(
      JSON.stringify({
        data: {
          browsebuddy_settings: { language: 'en' },
          browsebuddy_backup: { data: { nested: 'legacy blob' } },
        },
      })
    );

    const stored = await chrome.storage.local.get('browsebuddy_backup');
    expect(stored.browsebuddy_backup).toBeUndefined();
  });
});

describe('restoreBackup', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await resetStorage();
  });

  it('merges blacklists instead of overwriting (protects current entries)', async () => {
    await saveBlacklist([{ id: '1', pattern: 'new.com', type: 'exact', enabled: true, createdAt: 1 }]);

    const backup = {
      data: {
        browsebuddy_blacklist: [{ id: 'old', pattern: 'old.com', type: 'exact', enabled: true, createdAt: 1 }],
        browsebuddy_settings: { language: 'en' },
      },
    };

    await restoreBackup(JSON.stringify(backup));

    const blacklist = await getBlacklist();
    const patterns = blacklist.map(e => e.pattern).sort();
    expect(patterns).toEqual(['new.com', 'old.com']);
  });

  it('merges favorites instead of overwriting', async () => {
    await addFavorite('keep.com');

    const backup = {
      data: {
        browsebuddy_favorites: ['restored.com'],
      },
    };

    await restoreBackup(JSON.stringify(backup));

    const favorites = await getFavorites();
    expect(favorites).toContain('keep.com');
    expect(favorites).toContain('restored.com');
  });

  it('does nothing for invalid backup JSON', async () => {
    await expect(restoreBackup('not-json')).rejects.toThrow();
  });

  it('rejects a file without a data object', async () => {
    await expect(restoreBackup(JSON.stringify({ version: '1.0.0' }))).rejects.toThrow(
      /not a browsebuddy backup/i
    );
  });

  it('ignores keys the extension does not own', async () => {
    await restoreBackup(
      JSON.stringify({
        data: {
          browsebuddy_favorites: ['restored.com'],
          // A hand-edited file could carry anything, including a blob big enough
          // to exhaust the quota and break every later write.
          injected_key: 'x'.repeat(100),
          browsebuddy_stats_cache: { stale: true },
        },
      })
    );

    const stored = await chrome.storage.local.get(null);
    expect(stored.injected_key).toBeUndefined();
    expect(stored.browsebuddy_stats_cache).toBeUndefined();
    expect(await getFavorites()).toContain('restored.com');
  });

  it('merges settings field by field so absent fields keep their value', async () => {
    await saveSettings({ ...defaultSettings, theme: 'light', cleanupRetentionDays: 90 });

    await restoreBackup(
      JSON.stringify({ data: { browsebuddy_settings: { language: 'en' } } })
    );

    const settings = await getSettings();
    expect(settings.language).toBe('en');
    // Overwriting wholesale used to snap these back to the defaults.
    expect(settings.theme).toBe('light');
    expect(settings.cleanupRetentionDays).toBe(90);
  });

  it('drops settings values of the wrong type', async () => {
    await saveSettings({ ...defaultSettings, theme: 'light', cleanupRetentionDays: 90 });

    await restoreBackup(
      JSON.stringify({
        data: {
          browsebuddy_settings: {
            theme: 'neon',
            cleanupRetentionDays: 'thirty',
            realtimeProtection: false,
          },
        },
      })
    );

    const settings = await getSettings();
    expect(settings.theme).toBe('light');
    expect(settings.cleanupRetentionDays).toBe(90);
    expect(settings.realtimeProtection).toBe(false);
  });

  it('drops malformed blacklist entries but keeps the valid ones', async () => {
    await restoreBackup(
      JSON.stringify({
        data: {
          browsebuddy_blacklist: [
            { id: 'a', pattern: 'good.com', type: 'exact', enabled: true, createdAt: 1 },
            { id: 'b', pattern: 'bad.com', type: 'not-a-type', enabled: true, createdAt: 1 },
            { pattern: 'missing-id.com' },
            'a string',
            null,
          ],
        },
      })
    );

    const blacklist = await getBlacklist();
    expect(blacklist.map(e => e.pattern)).toEqual(['good.com']);
  });

  it('rejects a blacklist that is not an array', async () => {
    await expect(
      restoreBackup(JSON.stringify({ data: { browsebuddy_blacklist: { nope: 1 } } }))
    ).rejects.toThrow(/malformed blacklist/i);
  });

  it('rejects a file with no restorable keys instead of reporting success', async () => {
    await expect(
      restoreBackup(JSON.stringify({ data: { unrelated: true } }))
    ).rejects.toThrow(/no restorable data/i);
  });

  it('writes everything in a single set() call', async () => {
    const spy = vi.spyOn(chrome.storage.local, 'set');

    await restoreBackup(
      JSON.stringify({
        data: {
          browsebuddy_settings: { language: 'en' },
          browsebuddy_blacklist: [
            { id: 'a', pattern: 'a.com', type: 'exact', enabled: true, createdAt: 1 },
          ],
          browsebuddy_favorites: ['b.com'],
          browsebuddy_durations: { 'c.com': 1000 },
        },
      })
    );

    // Three sequential writes meant a failure partway through left settings from
    // the backup sitting next to the old blacklist.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(Object.keys(spy.mock.calls[0][0]).sort()).toEqual([
      'browsebuddy_blacklist',
      'browsebuddy_durations',
      'browsebuddy_favorites',
      'browsebuddy_settings',
    ]);
  });

  it('drops non-numeric durations', async () => {
    await restoreBackup(
      JSON.stringify({
        data: { browsebuddy_durations: { 'good.com': 500, 'bad.com': 'lots', 'neg.com': -1 } },
      })
    );

    const stored = await chrome.storage.local.get('browsebuddy_durations');
    expect(stored.browsebuddy_durations).toEqual({ 'good.com': 500 });
  });
});

describe('favorites', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await resetStorage();
  });

  it('adds main domain and dedupes', async () => {
    await addFavorite('www.example.com');
    await addFavorite('example.com'); // same main domain
    const favs = await getFavorites();
    expect(favs).toEqual(['example.com']);
  });

  it('removes by main domain', async () => {
    await addFavorite('example.com');
    await removeFavorite('www.example.com');
    expect(await getFavorites()).toEqual([]);
  });
});

describe('addUrlToBlacklist', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await resetStorage();
  });

  it('extracts main domain and stores it', async () => {
    const { entry } = await addUrlToBlacklist('https://www.example.com/page');
    expect(entry?.pattern).toBe('example.com');
    const blacklist = await getBlacklist();
    expect(blacklist).toHaveLength(1);
    expect(blacklist[0].pattern).toBe('example.com');
  });

  it('returns null entry when already blacklisted', async () => {
    await addUrlToBlacklist('example.com');
    const { entry } = await addUrlToBlacklist('https://example.com/other');
    expect(entry).toBeNull();
  });

  it('returns null entry for invalid url', async () => {
    const { entry } = await addUrlToBlacklist('not a url');
    expect(entry).toBeNull();
  });
});

describe('concurrent list mutations', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await resetStorage();
  });

  it('keeps both favorites when two adds are in flight', async () => {
    // Unserialized, both calls read the same empty list and the second set()
    // overwrote the first, so one of the two domains vanished.
    await Promise.all([addFavorite('one.com'), addFavorite('two.com')]);

    expect((await getFavorites()).sort()).toEqual(['one.com', 'two.com']);
  });

  it('keeps both entries when two blacklist adds are in flight', async () => {
    await Promise.all([
      addUrlToBlacklist('https://a.com'),
      addUrlToBlacklist('https://b.com'),
    ]);

    const patterns = (await getBlacklist()).map(e => e.pattern).sort();
    expect(patterns).toEqual(['a.com', 'b.com']);
  });

  it('adds the same domain only once when confirm is double-clicked', async () => {
    const [first, second] = await Promise.all([
      addUrlToBlacklist('https://example.com'),
      addUrlToBlacklist('https://example.com'),
    ]);

    const blacklist = await getBlacklist();
    expect(blacklist.map(e => e.pattern)).toEqual(['example.com']);
    // Exactly one call reports having created the entry.
    expect([first.entry, second.entry].filter(Boolean)).toHaveLength(1);
  });

  it('keeps both toggles when two rows are switched at once', async () => {
    await saveBlacklist([
      { id: 'a', pattern: 'a.com', type: 'exact', enabled: true, createdAt: 1 },
      { id: 'b', pattern: 'b.com', type: 'exact', enabled: true, createdAt: 2 },
    ]);

    await Promise.all([
      updateBlacklistEntry('a', { enabled: false }),
      updateBlacklistEntry('b', { enabled: false }),
    ]);

    expect((await getBlacklist()).map(e => e.enabled)).toEqual([false, false]);
  });
});

describe('getSettings defaults', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await resetStorage();
  });

  it('applies defaults when nothing stored', async () => {
    const s = await getSettings();
    expect(s.language).toBe('zh_CN');
    expect(s.theme).toBe('dark');
    expect(s.realtimeProtection).toBe(true);
    expect(s.autoCleanup).toBe(false);
    expect(s.cleanupRetentionDays).toBe(30);
  });
});

describe('read cache', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await resetStorage();
  });

  it('collapses concurrent reads of the same key into one get()', async () => {
    const spy = vi.spyOn(chrome.storage.local, 'get');

    // Opening the popup read the blacklist five times: the view filter, the
    // domain grouping, stats, the privacy list, and getVisibleDomainDurations.
    await Promise.all([
      getBlacklist(),
      getBlacklist(),
      getBlacklist(),
      getBlacklist(),
      getBlacklist(),
    ]);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('serves later reads from cache without touching storage', async () => {
    await getBlacklist();
    const spy = vi.spyOn(chrome.storage.local, 'get');

    await getBlacklist();

    expect(spy).not.toHaveBeenCalled();
  });

  it('does not serve a stale value after a write', async () => {
    await getBlacklist();

    await saveBlacklist([
      { id: '1', pattern: 'later.com', type: 'exact', enabled: true, createdAt: 1 },
    ]);

    expect((await getBlacklist()).map(e => e.pattern)).toEqual(['later.com']);
  });

  it('drops the cached value when another context writes the key', async () => {
    await getSettings();

    // Background worker and options page writes reach the popup only through
    // chrome.storage.onChanged - the extension has no message channel.
    await chrome.storage.local.set({
      browsebuddy_settings: { ...defaultSettings, theme: 'light' },
    });

    expect((await getSettings()).theme).toBe('light');
  });

  it('does not cache a rejection', async () => {
    const failing = vi
      .spyOn(chrome.storage.local, 'get')
      .mockRejectedValueOnce(new Error('storage unavailable'));

    // A cached rejection would turn one transient error into a permanent
    // "nothing is blacklisted" for the life of the context.
    await expect(getBlacklist()).rejects.toThrow('storage unavailable');
    failing.mockRestore();

    await expect(getBlacklist()).resolves.toEqual([]);
  });

  it('reads durations and blacklist once each for visible durations', async () => {
    await saveDomainDurations({ 'a.com': 1000 });
    const spy = vi.spyOn(chrome.storage.local, 'get');

    await getVisibleDomainDurations();
    await getVisibleDomainDurations();

    // Two keys, one read each, regardless of how many callers ask.
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
