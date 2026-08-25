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
  getSettings,
  saveSettings,
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
