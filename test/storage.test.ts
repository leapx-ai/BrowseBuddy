import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  restoreBackup,
  getBlacklist,
  getFavorites,
  addFavorite,
  removeFavorite,
  addUrlToBlacklist,
  saveBlacklist,
  getSettings,
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
