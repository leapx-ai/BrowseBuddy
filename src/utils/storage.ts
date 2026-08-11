import type { Settings, BlacklistEntry } from '../types';
import { fetchHistory, deleteSingleUrl } from './history';
import { extractMainDomain } from './blacklist';

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
  autoBackup: false,
  backupInterval: 7,
  sessionIncognito: false,
};

// Storage keys
const STORAGE_KEYS = {
  SETTINGS: 'browsebuddy_settings',
  BLACKLIST: 'browsebuddy_blacklist',
  STATS_CACHE: 'browsebuddy_stats_cache',
  BACKUP_DATA: 'browsebuddy_backup',
  DURATIONS: 'browsebuddy_durations',
};

// Per-domain accumulated dwell time (ms)
export async function getDomainDurations(): Promise<Record<string, number>> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.DURATIONS);
    return result[STORAGE_KEYS.DURATIONS] || {};
  } catch {
    return {};
  }
}

export async function saveDomainDurations(durations: Record<string, number>): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.DURATIONS]: durations });
}

// Settings management
export async function getSettings(): Promise<Settings> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    return { ...defaultSettings, ...result[STORAGE_KEYS.SETTINGS] };
  } catch {
    return defaultSettings;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
}

// Blacklist management
export async function getBlacklist(): Promise<BlacklistEntry[]> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.BLACKLIST);
    return result[STORAGE_KEYS.BLACKLIST] || [];
  } catch {
    return [];
  }
}

export async function saveBlacklist(blacklist: BlacklistEntry[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.BLACKLIST]: blacklist });
}

export async function addToBlacklist(entry: Omit<BlacklistEntry, 'id' | 'createdAt'>): Promise<BlacklistEntry> {
  const blacklist = await getBlacklist();
  const newEntry: BlacklistEntry = {
    ...entry,
    id: generateId(),
    createdAt: Date.now(),
  };
  await saveBlacklist([...blacklist, newEntry]);
  return newEntry;
}

export async function removeFromBlacklist(id: string): Promise<void> {
  const blacklist = await getBlacklist();
  await saveBlacklist(blacklist.filter(entry => entry.id !== id));
}

export async function updateBlacklistEntry(id: string, updates: Partial<BlacklistEntry>): Promise<void> {
  const blacklist = await getBlacklist();
  const updated = blacklist.map(entry => 
    entry.id === id ? { ...entry, ...updates } : entry
  );
  await saveBlacklist(updated);
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
  
  // Check if already exists
  const blacklist = await getBlacklist();
  const exists = blacklist.some(entry => entry.pattern === mainDomain);
  
  if (exists) {
    return { entry: null, deletedCount: 0 }; // Already in blacklist
  }
  
  let deletedCount = 0;
  
  // Delete existing history entries if requested
  if (deleteExisting) {
    deletedCount = await deleteHistoryByDomain(mainDomain);
  }
  
  // Add to blacklist
  const entry = await addToBlacklist({
    pattern: mainDomain,
    type: 'exact', // We store main domain as exact match
    enabled: true,
  });
  
  return { entry, deletedCount };
}

// Delete all history entries matching a domain (including subdomains)
async function deleteHistoryByDomain(domain: string): Promise<number> {
  try {
    const urlsToDelete = new Set<string>();
    const originalUrls = new Set<string>();

    // Iterate backwards through history page by page so we cover all records,
    // not just the most recent 10000 returned by a single query.
    // chrome.history.search's endTime is exclusive ("visited before this date"),
    // so advancing the cursor to `earliest` neither repeats nor skips records.
    const PAGE_SIZE = 2000;
    let endTime = Date.now();
    let reachedEnd = false;
    let pagesScanned = 0;
    const MAX_PAGES = 200;

    while (!reachedEnd) {
      const page = await fetchHistory({
        maxResults: PAGE_SIZE,
        dateRange: { start: 0, end: endTime },
      });

      if (page.length === 0) {
        break;
      }

      pagesScanned++;
      if (pagesScanned >= MAX_PAGES) {
        reachedEnd = true;
        break;
      }

      // Record the earliest visit time in this page as the boundary for the next query
      let earliest = Number.POSITIVE_INFINITY;

      page.forEach(item => {
        if (item.lastVisitTime && item.lastVisitTime < earliest) {
          earliest = item.lastVisitTime;
        }

        try {
          const itemDomain = extractMainDomain(item.url);
          if (itemDomain === domain) {
            urlsToDelete.add(item.url);
            originalUrls.add(item.url);
          }
        } catch {
          // Invalid URL, skip
        }
      });

      if (page.length < PAGE_SIZE) {
        reachedEnd = true;
      } else if (Number.isFinite(earliest)) {
        endTime = earliest;
      } else {
        // No timestamps on any record - cannot advance the cursor safely.
        reachedEnd = true;
      }

      // Safety valve to avoid infinite loops
      if (endTime <= 0) {
        break;
      }
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
export async function createBackup(): Promise<string> {
  const data = await chrome.storage.local.get(null);
  const backup = {
    version: '1.0.0',
    timestamp: Date.now(),
    data,
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.BACKUP_DATA]: backup });
  return JSON.stringify(backup);
}

export async function restoreBackup(backupJson: string): Promise<void> {
  const backup = JSON.parse(backupJson);
  if (!backup.data) return;

  // Never overwrite the current blacklist with an older backup's list.
  // Otherwise a stale backup would silently remove domains the user has
  // already blacklisted, re-exposing history that was previously scrubbed.
  const currentBlacklist = await getBlacklist();
  const backupBlacklist: BlacklistEntry[] = backup.data[STORAGE_KEYS.BLACKLIST] || [];

  const mergedPatterns = new Set([
    ...currentBlacklist.map(e => e.pattern),
    ...backupBlacklist.map(e => e.pattern),
  ]);
  const mergedBlacklist: BlacklistEntry[] = Array.from(mergedPatterns)
    .map(pattern => {
      return (
        currentBlacklist.find(e => e.pattern === pattern) ||
        backupBlacklist.find(e => e.pattern === pattern) ||
        null
      );
    })
    .filter((e): e is BlacklistEntry => e !== null);

  await chrome.storage.local.set(backup.data);
  await saveBlacklist(mergedBlacklist);
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
