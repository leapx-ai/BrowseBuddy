import type { Settings, BlacklistEntry } from '../types';
import { fetchAllHistory, deleteSingleUrl } from './history';
import { extractMainDomain, isUrlBlacklisted } from './blacklist';

// Re-export types for convenience
export type { Settings, BlacklistEntry } from '../types';
// Backwards-compatible re-exports
export { extractMainDomain, isUrlBlacklisted, filterBlacklistedItems } from './blacklist';

// Default settings
export const defaultSettings: Settings = {
  language: 'zh_CN',
  theme: 'dark',
  realtimeProtection: true,
  showPrivacyReminder: true,
  sessionIncognito: false,
  autoCleanup: false,
  cleanupRetentionDays: 30,
};

// Storage keys
const STORAGE_KEYS = {
  SETTINGS: 'browsebuddy_settings',
  BLACKLIST: 'browsebuddy_blacklist',
  STATS_CACHE: 'browsebuddy_stats_cache',
  BACKUP_DATA: 'browsebuddy_backup',
  DURATIONS: 'browsebuddy_durations',
  FAVORITES: 'browsebuddy_favorites',
};

// Serializes read-modify-write sequences against chrome.storage.local.
//
// Every list mutation here is get() -> modify -> set(). Two of them running at
// once both read the same starting list, and the second set() overwrites the
// first - so toggling one blacklist row while another add is in flight silently
// discarded one of the two changes. Awaiting the previous task keeps each
// sequence indivisible.
//
// Scope: this is a per-context queue. The popup, the options page and the
// service worker each have their own module instance, so it removes the races
// within one context but not a popup write landing on top of a background
// write. chrome.storage exposes no transaction or compare-and-swap to close
// that, and in practice the background worker only writes durations while the UI
// writes lists, so the remaining overlap is narrow.
let storageQueue: Promise<unknown> = Promise.resolve();

function withStorageLock<T>(task: () => Promise<T>): Promise<T> {
  // Run regardless of whether the previous task settled or rejected.
  const run = storageQueue.then(task, task);
  storageQueue = run.catch(() => undefined);
  return run;
}

// Shared read cache for the four keys this module owns.
//
// Nothing shared reads before this: opening the popup read the blacklist five
// separate times (view filter, domain grouping, stats, privacy list, and again
// inside getVisibleDomainDurations), and every module re-read settings on
// mount. chrome.storage.local is not free - each call crosses into the browser
// process and yields to the event loop - so those turned into avoidable frames
// of latency on the one path where the popup has to paint fast.
//
// Two mechanisms, both required:
//   - in-flight sharing, so N callers awaiting the same key in the same tick
//     issue one get() rather than N;
//   - a resolved-value cache, invalidated on write and on chrome.storage
//     onChanged, so a later mount reuses what is already known.
//
// onChanged is what makes this safe across contexts. Chrome fires it in every
// context for every local-storage write, including writes made by the service
// worker or the options page, so a cached value cannot outlive the data it
// mirrors. This is the same channel App.tsx already listens on for settings;
// here it covers all four keys instead of one.
const CACHED_KEYS: readonly string[] = [
  STORAGE_KEYS.SETTINGS,
  STORAGE_KEYS.BLACKLIST,
  STORAGE_KEYS.FAVORITES,
  STORAGE_KEYS.DURATIONS,
];

const cachedValues = new Map<string, unknown>();
const inFlightReads = new Map<string, Promise<unknown>>();
// Bumped on every write and every onChanged. A read that started before a bump
// must not install its result, because that result predates the write.
const generations = new Map<string, number>();

function generationOf(key: string): number {
  return generations.get(key) ?? 0;
}

function invalidate(key: string): void {
  generations.set(key, generationOf(key) + 1);
  cachedValues.delete(key);
  inFlightReads.delete(key);
}

function readCached<T>(key: string, load: () => Promise<T>): Promise<T> {
  if (cachedValues.has(key)) {
    return Promise.resolve(cachedValues.get(key) as T);
  }
  const pending = inFlightReads.get(key);
  if (pending) {
    return pending as Promise<T>;
  }

  const startedAt = generationOf(key);
  const run = load().then(
    value => {
      if (generationOf(key) === startedAt) {
        cachedValues.set(key, value);
        inFlightReads.delete(key);
      }
      return value;
    },
    error => {
      // Failures are never cached. getBlacklist and getFavorites propagate on
      // purpose (see their comments below); caching a rejection would turn one
      // transient storage error into a permanent one for the life of the
      // context, which is exactly the silent-degradation failure those
      // accessors were changed to avoid.
      if (inFlightReads.get(key) === run) inFlightReads.delete(key);
      throw error;
    }
  );
  inFlightReads.set(key, run);
  return run;
}

// The single write path for the cached keys. Invalidating both before and after
// the set() closes the window where a read issued mid-write would otherwise
// park the pre-write value in the cache.
async function writeCachedKeys(items: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(items);
  keys.forEach(invalidate);
  try {
    await chrome.storage.local.set(items);
  } finally {
    keys.forEach(invalidate);
  }
}

if (typeof chrome !== 'undefined' && chrome.storage?.onChanged?.addListener) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    for (const key of Object.keys(changes)) {
      if (CACHED_KEYS.includes(key)) invalidate(key);
    }
  });
}

// Favorited (protected) main domains - never auto-cleaned, never counted for deletion
//
// Read errors propagate on purpose. Returning [] on failure meant "nothing is
// protected", so a transient storage error silently turned the protection off
// and favorited domains became eligible for deletion. Callers must decide, and
// for a protection list the only safe decision is to not proceed.
export async function getFavorites(): Promise<string[]> {
  return readCached(STORAGE_KEYS.FAVORITES, async () => {
    const result = await chrome.storage.local.get(STORAGE_KEYS.FAVORITES);
    return (result[STORAGE_KEYS.FAVORITES] || []) as string[];
  });
}

export async function saveFavorites(domains: string[]): Promise<void> {
  await writeCachedKeys({ [STORAGE_KEYS.FAVORITES]: domains });
}

export async function addFavorite(domain: string): Promise<void> {
  const mainDomain = extractMainDomain(domain);
  if (!mainDomain) return;
  return withStorageLock(async () => {
    const favorites = await getFavorites();
    if (!favorites.includes(mainDomain)) {
      await saveFavorites([...favorites, mainDomain]);
    }
  });
}

export async function removeFavorite(domain: string): Promise<void> {
  const mainDomain = extractMainDomain(domain);
  return withStorageLock(async () => {
    const favorites = await getFavorites();
    await saveFavorites(favorites.filter(d => d !== mainDomain));
  });
}

// Per-domain accumulated dwell time (ms)
export async function getDomainDurations(): Promise<Record<string, number>> {
  return readCached(STORAGE_KEYS.DURATIONS, async () => {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEYS.DURATIONS);
      return (result[STORAGE_KEYS.DURATIONS] || {}) as Record<string, number>;
    } catch {
      return {};
    }
  });
}

export async function saveDomainDurations(durations: Record<string, number>): Promise<void> {
  await writeCachedKeys({ [STORAGE_KEYS.DURATIONS]: durations });
}

// Add elapsed dwell time to one domain's running total.
//
// The background worker used to hold its own copy of the entire map at module
// scope and write it back wholesale. That bypassed withStorageLock in the worst
// way: the copy was loaded once when the worker woke and could be minutes old,
// so a purge from the UI (addUrlToBlacklist -> removeDomainDuration) was simply
// overwritten on the next tab switch and the blacklisted domain reappeared
// under "Most Time Spent".
//
// Reading inside the lock makes the operation additive instead of a wholesale
// replace. The lock is still per-context, so this does not make the increment
// atomic against a simultaneous write from the popup - but the worker now reads
// current data (the cache above is dropped by onChanged as soon as the popup
// writes) rather than a snapshot from an arbitrary point in the past.
export async function addDwellTime(domain: string, elapsedMs: number): Promise<void> {
  if (!domain || elapsedMs <= 0) return;
  return withStorageLock(async () => {
    const durations = await getDomainDurations();
    await saveDomainDurations({
      ...durations,
      [domain]: (durations[domain] || 0) + elapsedMs,
    });
  });
}

// Durations with blacklisted domains removed. Mirrors fetchHistory /
// fetchVisibleHistory: the raw accessor above is for the background worker,
// which needs the full map to write back, while anything user-facing must go
// through here. The stats panel previously used the raw map, so a domain the
// user had blacklisted still appeared under "Most Time Spent" and was written
// into exported reports.
export async function getVisibleDomainDurations(): Promise<Record<string, number>> {
  const durations = await getDomainDurations();
  const blacklist = await getBlacklist();
  if (blacklist.length === 0) return durations;

  const visible: Record<string, number> = {};
  for (const [domain, ms] of Object.entries(durations)) {
    // Keys are already main domains, but go through the URL form so matching
    // uses the same semantics as everywhere else.
    if (!isUrlBlacklisted(`https://${domain}`, blacklist)) {
      visible[domain] = ms;
    }
  }
  return visible;
}

// Settings management
export async function getSettings(): Promise<Settings> {
  return readCached(STORAGE_KEYS.SETTINGS, async () => {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
      return { ...defaultSettings, ...result[STORAGE_KEYS.SETTINGS] };
    } catch {
      return defaultSettings;
    }
  });
}

export async function saveSettings(settings: Settings): Promise<void> {
  await writeCachedKeys({ [STORAGE_KEYS.SETTINGS]: settings });
}

// Blacklist management
//
// Read errors propagate for the same reason as getFavorites: `catch { return [] }`
// meant "no domain is blacklisted", so a transient storage failure disabled the
// extension's core privacy guarantee with no log, no badge and no UI signal -
// and since background and UI share no message channel, nothing could ever
// notice. Callers handle the failure explicitly.
export async function getBlacklist(): Promise<BlacklistEntry[]> {
  return readCached(STORAGE_KEYS.BLACKLIST, async () => {
    const result = await chrome.storage.local.get(STORAGE_KEYS.BLACKLIST);
    return (result[STORAGE_KEYS.BLACKLIST] || []) as BlacklistEntry[];
  });
}

export async function saveBlacklist(blacklist: BlacklistEntry[]): Promise<void> {
  await writeCachedKeys({ [STORAGE_KEYS.BLACKLIST]: blacklist });
}

export async function addToBlacklist(entry: Omit<BlacklistEntry, 'id' | 'createdAt'>): Promise<BlacklistEntry> {
  return withStorageLock(async () => {
    const blacklist = await getBlacklist();
    const newEntry: BlacklistEntry = {
      ...entry,
      id: generateId(),
      createdAt: Date.now(),
    };
    await saveBlacklist([...blacklist, newEntry]);
    return newEntry;
  });
}

export async function removeFromBlacklist(id: string): Promise<void> {
  return withStorageLock(async () => {
    const blacklist = await getBlacklist();
    await saveBlacklist(blacklist.filter(entry => entry.id !== id));
  });
}

export async function updateBlacklistEntry(id: string, updates: Partial<BlacklistEntry>): Promise<void> {
  return withStorageLock(async () => {
    const blacklist = await getBlacklist();
    const updated = blacklist.map(entry =>
      entry.id === id ? { ...entry, ...updates } : entry
    );
    await saveBlacklist(updated);
  });
}

// Add URL to blacklist - automatically extracts main domain
// If deleteExisting is true, also delete existing history entries for this domain
export async function addUrlToBlacklist(
  url: string, 
  deleteExisting: boolean = false
): Promise<{ entry: BlacklistEntry | null; deletedCount: number }> {
  const mainDomain = extractMainDomain(url);
  
  if (!mainDomain) {
    return { entry: null, deletedCount: 0 };
  }
  
  // Check-and-insert has to be one critical section. Split apart, two calls
  // (a double-click on Confirm, or the popup and the context menu at once) both
  // saw "not present" and both appended, leaving duplicate entries for the same
  // domain in the list.
  const entry = await withStorageLock(async () => {
    const blacklist = await getBlacklist();
    if (blacklist.some(e => e.pattern === mainDomain)) return null;

    // Add to the blacklist FIRST. deleteHistoryByDomain can run for tens of
    // seconds on a heavily visited domain (it sleeps 50ms every 10 deletions),
    // and if the service worker is torn down during that window the protective
    // write never lands - the user sees no error and the domain is not
    // blacklisted. The cheap, protective write has to be the one that survives.
    const newEntry: BlacklistEntry = {
      pattern: mainDomain,
      type: 'exact', // We store main domain as exact match
      enabled: true,
      id: generateId(),
      createdAt: Date.now(),
    };
    await saveBlacklist([...blacklist, newEntry]);
    return newEntry;
  });

  if (!entry) {
    return { entry: null, deletedCount: 0 }; // Already in blacklist
  }

  let deletedCount = 0;

  // Dwell time is stored separately from history, and nothing else purges it.
  // Leaving it behind meant a blacklisted domain kept showing up under
  // "Most Time Spent" and in every exported report.
  await removeDomainDuration(mainDomain);

  // Delete existing history entries if requested
  if (deleteExisting) {
    deletedCount = await deleteHistoryByDomain(mainDomain);
  }

  return { entry, deletedCount };
}

// Drop a single domain's accumulated dwell time.
async function removeDomainDuration(domain: string): Promise<void> {
  return withStorageLock(async () => {
    const durations = await getDomainDurations();
    if (!(domain in durations)) return;
    delete durations[domain];
    await saveDomainDurations(durations);
  });
}

// Delete all history entries matching a domain (including subdomains)
async function deleteHistoryByDomain(domain: string): Promise<number> {
  try {
    // The page-by-page walk this used to do by hand was a second copy of
    // fetchAllHistory's loop, with its own PAGE_SIZE, its own MAX_PAGES (200 vs
    // 50) and its own domain test (main-domain equality vs the exact-or-subdomain
    // rule used everywhere else). Two loops meant two places to fix whenever
    // Chrome's pagination semantics bit, and the delete path - the one that
    // destroys data - was the copy with less test coverage.
    const matches = await fetchAllHistory({
      domains: [domain],
      maxResults: 20000,
    });

    const urlsToDelete = new Set<string>();
    const originalUrls = new Set<string>();
    for (const item of matches) {
      urlsToDelete.add(item.url);
      originalUrls.add(item.url);
    }

    // Also add URL variants (http/https, www/non-www) to ensure thorough cleanup
    originalUrls.forEach(url => {
      try {
        const urlObj = new URL(url);
        // Add variant with/without www
        if (urlObj.hostname.startsWith('www.')) {
          const withoutWww = url.replace('://www.', '://');
          urlsToDelete.add(withoutWww);
        } else {
          const withWww = url.replace('://', '://www.');
          urlsToDelete.add(withWww);
        }
        // Add protocol variant
        if (urlObj.protocol === 'https:') {
          urlsToDelete.add(url.replace('https://', 'http://'));
        } else if (urlObj.protocol === 'http:') {
          urlsToDelete.add(url.replace('http://', 'https://'));
        }
      } catch {
        // Invalid URL, skip variants
      }
    });

    // Delete each URL with a small delay to ensure Chrome processes the deletion
    let deletedCount = 0;
    const urlsArray = Array.from(urlsToDelete);

    for (let i = 0; i < urlsArray.length; i++) {
      const url = urlsArray[i];
      try {
        await deleteSingleUrl(url);
        // Check if this was an original URL (not a variant)
        if (originalUrls.has(url)) {
          deletedCount++;
        }
      } catch {
        // Continue with next item
      }
      
      // Add a small delay every 10 items to avoid overwhelming Chrome
      if ((i + 1) % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    
    return deletedCount;
  } catch (error) {
    console.error('Failed to delete history by domain:', error);
    return 0;
  }
}

// Backup and restore
//
// Produces the JSON the options page downloads. It deliberately does NOT write
// a copy back into chrome.storage.local: the previous version snapshotted
// get(null) - which includes the previous snapshot - so every backup embedded
// the one before it and the stored size doubled each time. Around ten runs that
// exhausts the quota, after which every set() in the extension rejects and
// failures like "new blacklist entry not saved" become silent.
//
// A copy inside the same storage it is backing up also shares its failure
// domain, and nothing in the codebase ever read that key.
export async function createBackup(): Promise<string> {
  const data = await chrome.storage.local.get(null);
  // Drop any snapshot left behind by an older version so it is not carried
  // into the exported file (and re-imported on restore).
  delete data[STORAGE_KEYS.BACKUP_DATA];
  const backup = {
    version: '1.0.0',
    timestamp: Date.now(),
    data,
  };
  return JSON.stringify(backup);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// One check per settings field. Anything that fails keeps the current value,
// which also means fields retired between versions (autoBackup, backupInterval)
// are dropped instead of being written back.
const settingsValidators: { [K in keyof Settings]: (value: unknown) => boolean } = {
  language: v => v === 'en' || v === 'zh_CN',
  theme: v => v === 'dark' || v === 'light' || v === 'system',
  realtimeProtection: v => typeof v === 'boolean',
  showPrivacyReminder: v => typeof v === 'boolean',
  sessionIncognito: v => typeof v === 'boolean',
  autoCleanup: v => typeof v === 'boolean',
  cleanupRetentionDays: v => typeof v === 'number' && Number.isFinite(v) && v > 0,
};

// Validate one entry from a backup file and normalize it.
//
// `type` is accepted in its legacy spellings ('wildcard', 'regex') because older
// backups may carry them, but it is stored as 'exact': that is the only matching
// mode implemented, so keeping the original string would have the entry claim a
// behaviour it does not get.
function toBlacklistEntry(value: unknown): BlacklistEntry | null {
  if (!isPlainObject(value)) return null;
  const typeIsKnown =
    value.type === 'exact' || value.type === 'wildcard' || value.type === 'regex';
  if (
    typeof value.id !== 'string' ||
    typeof value.pattern !== 'string' ||
    value.pattern.length === 0 ||
    !typeIsKnown ||
    typeof value.enabled !== 'boolean' ||
    typeof value.createdAt !== 'number'
  ) {
    return null;
  }
  return {
    id: value.id,
    pattern: value.pattern,
    type: 'exact',
    enabled: value.enabled,
    createdAt: value.createdAt,
  };
}

// Restore from a user-supplied file.
//
// The file is untrusted input: it may be hand-edited, truncated, or written by a
// different version. Two rules follow from that:
//
//   1. Only the keys this extension owns are written, and each one is validated
//      before it is accepted. The previous version passed the parsed object
//      straight to set(), so any key in the file landed in storage - including
//      junk large enough to exhaust the quota and break every later write.
//   2. Everything is assembled first and written in a single set() call. The
//      previous version issued three sequential writes, so a failure partway
//      through left settings from the backup next to the old blacklist.
//
// Absent keys are left as they are rather than reset, and settings are merged
// field by field - a backup missing a field no longer silently reverts it to
// the default.
export function restoreBackup(backupJson: string): Promise<void> {
  // Merging reads the current lists, so it has to be indivisible too - a toggle
  // landing between the read and the write would be lost.
  return withStorageLock(() => restoreBackupLocked(backupJson));
}

async function restoreBackupLocked(backupJson: string): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(backupJson);
  } catch {
    throw new Error('Not a valid JSON file');
  }
  if (!isPlainObject(parsed) || !isPlainObject(parsed.data)) {
    throw new Error('Not a BrowseBuddy backup file');
  }
  const data = parsed.data;

  const next: Record<string, unknown> = {};

  if (STORAGE_KEYS.SETTINGS in data) {
    if (!isPlainObject(data[STORAGE_KEYS.SETTINGS])) {
      throw new Error('Backup contains malformed settings');
    }
    const incoming = data[STORAGE_KEYS.SETTINGS] as Record<string, unknown>;
    const current = await getSettings();
    const merged: Record<string, unknown> = { ...current };
    for (const key of Object.keys(settingsValidators) as (keyof Settings)[]) {
      if (key in incoming && settingsValidators[key](incoming[key])) {
        merged[key] = incoming[key];
      }
    }
    next[STORAGE_KEYS.SETTINGS] = merged;
  }

  if (STORAGE_KEYS.BLACKLIST in data) {
    const incoming = data[STORAGE_KEYS.BLACKLIST];
    if (!Array.isArray(incoming)) {
      throw new Error('Backup contains malformed blacklist');
    }
    // Never overwrite the current blacklist with an older backup's list.
    // Otherwise a stale backup would silently remove domains the user has
    // already blacklisted, re-exposing history that was previously scrubbed.
    const current = await getBlacklist();
    const valid = incoming
      .map(toBlacklistEntry)
      .filter((entry): entry is BlacklistEntry => entry !== null);
    const byPattern = new Map<string, BlacklistEntry>();
    for (const entry of [...valid, ...current]) {
      byPattern.set(entry.pattern, entry); // current wins on collision
    }
    next[STORAGE_KEYS.BLACKLIST] = Array.from(byPattern.values());
  }

  if (STORAGE_KEYS.FAVORITES in data) {
    const incoming = data[STORAGE_KEYS.FAVORITES];
    if (!Array.isArray(incoming)) {
      throw new Error('Backup contains malformed favorites');
    }
    // Same protection for favorites - merging rather than overwriting so a
    // stale backup can't drop domains the user favorited (and thus unprotect
    // them from deletion).
    const current = await getFavorites();
    const valid = incoming.filter((d): d is string => typeof d === 'string' && d.length > 0);
    next[STORAGE_KEYS.FAVORITES] = Array.from(new Set([...current, ...valid]));
  }

  if (STORAGE_KEYS.DURATIONS in data) {
    const incoming = data[STORAGE_KEYS.DURATIONS];
    if (!isPlainObject(incoming)) {
      throw new Error('Backup contains malformed durations');
    }
    const durations: Record<string, number> = {};
    for (const [domain, ms] of Object.entries(incoming)) {
      if (typeof ms === 'number' && Number.isFinite(ms) && ms >= 0) {
        durations[domain] = ms;
      }
    }
    next[STORAGE_KEYS.DURATIONS] = durations;
  }

  // STATS_CACHE and BACKUP_DATA are intentionally not restored: the first is
  // derived data that rebuilds itself, the second is a snapshot left by an older
  // version whose nesting is what caused the growth described above.

  if (Object.keys(next).length === 0) {
    throw new Error('Backup contains no restorable data');
  }

  await writeCachedKeys(next);
}

// Delete history older than the retention cutoff, protecting favorited domains.
export async function cleanupOldHistory(retentionDays: number): Promise<number> {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const favorites = await getFavorites();

  // Paginated. A single fetchHistory() call is capped at the most recent N
  // records of the range, so on a large history the daily auto-cleanup deleted
  // the newest 10000 of the *old* records and silently left the rest - the ones
  // furthest past the retention cutoff, which are exactly the ones it exists to
  // remove. It then reported the truncated count as success.
  const items = await fetchAllHistory({
    maxResults: 20000,
    dateRange: { start: 0, end: cutoff },
  });

  const toDelete = items.filter(item => {
    if (!item.url) return false;
    const mainDomain = extractMainDomain(item.url);
    // Never delete favorited domains
    if (favorites.includes(mainDomain)) return false;
    return true;
  });

  let deleted = 0;
  for (let i = 0; i < toDelete.length; i++) {
    try {
      await deleteSingleUrl(toDelete[i].url);
      deleted++;
    } catch {
      // Continue
    }
    if ((i + 1) % 10 === 0) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  return deleted;
}

// Get storage usage
export async function getStorageUsage(): Promise<{ used: number; total: number }> {
  const bytes = await chrome.storage.local.getBytesInUse();
  // Chrome storage limit is typically 5MB (5,242,880 bytes) for local storage
  return { used: bytes, total: 5242880 };
}

// Helper function
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
