import type { Settings, BlacklistEntry } from '../types';

// Re-export types for convenience
export type { Settings, BlacklistEntry } from '../types';

// Default settings
export const defaultSettings: Settings = {
  language: 'zh_CN',
  theme: 'dark',
  realtimeProtection: true,
  showPrivacyReminder: true,
  autoBackup: false,
  backupInterval: 7,
};

// Storage keys
const STORAGE_KEYS = {
  SETTINGS: 'browsebuddy_settings',
  BLACKLIST: 'browsebuddy_blacklist',
  STATS_CACHE: 'browsebuddy_stats_cache',
  BACKUP_DATA: 'browsebuddy_backup',
};

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

// Extract main domain from URL or hostname
// e.g., "www.xchina.co" -> "xchina.co", "sub.www.example.com.cn" -> "example.com.cn"
export function extractMainDomain(url: string): string {
  try {
    const hostname = url.includes('://') ? new URL(url).hostname : url;
    const parts = hostname.split('.');
    
    // Handle special cases like .co.uk, .com.cn, .org.cn, .net.cn, .gov.cn, .ac.uk, etc.
    const specialTlds = ['co', 'com', 'org', 'net', 'gov', 'ac', 'edu', 'mil'];
    
    if (parts.length >= 3) {
      const lastTwo = parts.slice(-2);
      const lastThree = parts.slice(-3);
      
      // Check if it's a special TLD pattern (e.g., example.co.uk)
      if (specialTlds.includes(lastTwo[0]) && lastTwo[1].length <= 3) {
        return parts.slice(-3).join('.');
      }
    }
    
    // Standard case: last two parts are the main domain
    if (parts.length >= 2) {
      return parts.slice(-2).join('.');
    }
    
    return hostname;
  } catch {
    return url;
  }
}

// Check if URL matches blacklist
// Now all entries are main domains and match any subdomain of that domain
export function isUrlBlacklisted(url: string, blacklist: BlacklistEntry[]): boolean {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    const mainDomain = extractMainDomain(hostname);
    
    return blacklist.some(entry => {
      if (!entry.enabled) return false;
      // Entry pattern is the main domain, check if URL's main domain matches
      return mainDomain === entry.pattern;
    });
  } catch {
    return false;
  }
}

// Add URL to blacklist - automatically extracts main domain
export async function addUrlToBlacklist(url: string): Promise<BlacklistEntry | null> {
  const mainDomain = extractMainDomain(url);
  
  if (!mainDomain) {
    return null;
  }
  
  // Check if already exists
  const blacklist = await getBlacklist();
  const exists = blacklist.some(entry => entry.pattern === mainDomain);
  
  if (exists) {
    return null; // Already in blacklist
  }
  
  return await addToBlacklist({
    pattern: mainDomain,
    type: 'exact', // We store main domain as exact match
    enabled: true,
  });
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
  if (backup.data) {
    await chrome.storage.local.set(backup.data);
  }
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
