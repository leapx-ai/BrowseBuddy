import {
  getSettings,
  getBlacklist,
  isUrlBlacklisted,
  saveBlacklist,
  addUrlToBlacklist,
  getDomainDurations,
  saveDomainDurations,
  createBackup,
} from "../utils/storage";
import { extractMainDomain } from "../utils/blacklist";

// Track active tab times for duration calculation
interface TabInfo {
  url: string;
  startTime: number;
}

const activeTabs = new Map<number, TabInfo>();

// Persisted per-domain accumulated dwell time in milliseconds
let domainDurations: Record<string, number> = {};

// Load durations on startup so stats survive service worker restarts
getDomainDurations().then(d => {
  domainDurations = d;
});

// Settle the accumulated time for a tab and merge it into the domain totals.
async function settleTabDuration(tabId: number) {
  const tab = activeTabs.get(tabId);
  if (!tab) return;

  activeTabs.delete(tabId);

  const elapsed = Date.now() - tab.startTime;
  if (elapsed < 1000) return; // ignore sub-second flashes

  const domain = extractMainDomain(tab.url);
  if (!domain) return;

  // Never count time on blacklisted domains or internal pages
  const settings = await getSettings();
  const blacklist = await getBlacklist();
  if (settings.sessionIncognito || isUrlBlacklisted(tab.url, blacklist)) return;

  domainDurations[domain] = (domainDurations[domain] || 0) + elapsed;
  // Debounce writes - flush immediately for simplicity (this only runs on
  // tab switches/updates which are relatively infrequent)
  saveDomainDurations(domainDurations).catch(() => {});
}

// Sync badge with persisted session incognito state on startup
getSettings().then(settings => {
  syncIncognitoBadge(settings.sessionIncognito);
  syncAutoBackupAlarm(settings.autoBackup, settings.backupInterval);
});

// Manage the periodic auto-backup alarm based on settings.
// MV3 alarms fire at most once per minute; a minimum interval of 1 hour
// is enforced to avoid excessive writes.
function syncAutoBackupAlarm(enabled: boolean, intervalDays: number) {
  if (!chrome.alarms) return;

  const minutes = Math.max(Math.round(intervalDays * 24 * 60), 60);
  if (enabled) {
    chrome.alarms.create("auto-backup", { periodInMinutes: minutes });
  } else {
    chrome.alarms.clear("auto-backup");
  }
}

// Initialize extension
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    // First install - show welcome page
    chrome.tabs.create({
      url: chrome.runtime.getURL("options.html?welcome=true"),
    });

    // Initialize empty blacklist (no default entries)
    await saveBlacklist([]);
  }
});

// Listen for tab updates to check blacklist
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.url) {
    const blacklist = await getBlacklist();

    if (isUrlBlacklisted(tab.url, blacklist)) {
      const settings = await getSettings();

      // Remove this URL from history if real-time protection is enabled
      if (settings.realtimeProtection) {
        try {
          chrome.history.deleteUrl({ url: tab.url });
        } catch {
          // Ignore errors
        }
      }

      // Show privacy reminder if enabled
      if (settings.showPrivacyReminder) {
        chrome.action.setBadgeText({ text: "🔒", tabId });
        chrome.action.setBadgeBackgroundColor({ color: "#4CAF50" });

        setTimeout(() => {
          chrome.action.setBadgeText({ text: "", tabId });
        }, 3000);
      }
    }
  }
});

// Backstop: immediately scrub any new history entry that matches the blacklist.
// This catches URLs written by other means (e.g. background tabs, redirects,
// other profiles) that tabs.onUpdated alone would miss.
// When session incognito is enabled, ALL new entries are scrubbed so the
// current browsing session leaves no trace in history.
chrome.history.onVisited.addListener(async (item) => {
  if (!item.url) return;

  const settings = await getSettings();

  if (settings.sessionIncognito) {
    try {
      await chrome.history.deleteUrl({ url: item.url });
    } catch {
      // Ignore errors
    }
    return;
  }

  if (!settings.realtimeProtection) return;

  const blacklist = await getBlacklist();
  if (isUrlBlacklisted(item.url, blacklist)) {
    try {
      await chrome.history.deleteUrl({ url: item.url });
    } catch {
      // Ignore errors
    }
  }
});

// Track tab activation for duration stats
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  // Settle whatever tab was previously active
  for (const tabId of Array.from(activeTabs.keys())) {
    if (tabId !== activeInfo.tabId) {
      await settleTabDuration(tabId);
    }
  }

  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(activeInfo.tabId);
  } catch {
    // Tab may have been closed between activation and lookup
    return;
  }

  if (
    tab.url &&
    !tab.url.startsWith("chrome://") &&
    !tab.url.startsWith("chrome-extension://")
  ) {
    activeTabs.set(activeInfo.tabId, {
      url: tab.url,
      startTime: Date.now(),
    });
  }
});

// Settle a tab's duration when it is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  settleTabDuration(tabId);
});

// Settle and re-record when a tab's URL changes mid-flight
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.url && activeTabs.has(tabId)) {
    settleTabDuration(tabId).then(() => {
      activeTabs.set(tabId, {
        url: tab.url!,
        startTime: Date.now(),
      });
    });
  }
});

// Periodic tasks driven by alarms (auto-backup, etc.)
chrome.alarms?.onAlarm?.addListener((alarm) => {
  if (alarm.name === "auto-backup") {
    createBackup().catch(() => {});
  }
});

// Keep the toolbar badge in sync with session incognito state,
// and keep the auto-backup alarm in sync with settings changes.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.browsebuddy_settings) {
    const settings = changes.browsebuddy_settings.newValue;
    if (settings) {
      syncIncognitoBadge(settings.sessionIncognito);
      syncAutoBackupAlarm(settings.autoBackup, settings.backupInterval);
    }
  }
});

function syncIncognitoBadge(enabled: boolean) {
  if (enabled) {
    chrome.action.setBadgeText({ text: "🕶️" });
    chrome.action.setBadgeBackgroundColor({ color: "#6C5CE7" });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

// Context menu for quick actions - guarded against undefined contextMenus
if (typeof chrome !== "undefined" && chrome.contextMenus) {
  // Create context menu on installation
  chrome.runtime.onInstalled.addListener(() => {
    try {
      chrome.contextMenus.create({
        id: "add-to-blacklist",
        title: "Add domain to BrowseBuddy blacklist",
        contexts: ["page", "link"],
      });
    } catch (error) {
      // Menu might already exist or API not available
      console.log("BrowseBuddy: Context menu creation skipped", error);
    }
  });

  // Handle context menu clicks
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== "add-to-blacklist") return;
    const targetUrl = info.linkUrl || info.pageUrl || tab?.url;
    if (!targetUrl) return;
    try {
      const url = new URL(targetUrl);
      await addUrlToBlacklist(url.hostname, true);
    } catch {
      // Invalid URL
    }
  });
}
