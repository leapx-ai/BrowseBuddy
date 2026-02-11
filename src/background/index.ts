import {
  getSettings,
  getBlacklist,
  isUrlBlacklisted,
  saveBlacklist,
} from "../utils/storage";
import type { BlacklistEntry } from "../types";

// Track active tab times for duration calculation
interface TabInfo {
  url: string;
  startTime: number;
}

const activeTabs = new Map<number, TabInfo>();

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

      // Remove this URL from history
      try {
        chrome.history.deleteUrl({ url: tab.url });
      } catch {
        // Ignore errors
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

// Track tab activation for duration stats
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);

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

// Handle messages from popup/options
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  (async () => {
    try {
      switch (request.type) {
        case "GET_HISTORY":
          const history = await chrome.history.search({
            text: request.keyword || "",
            maxResults: request.maxResults || 100,
            startTime: request.startTime,
            endTime: request.endTime,
          });
          sendResponse({ success: true, data: history });
          break;

        case "DELETE_URL":
          await chrome.history.deleteUrl({ url: request.url });
          sendResponse({ success: true });
          break;

        case "DELETE_RANGE":
          await chrome.history.deleteRange({
            startTime: request.startTime,
            endTime: request.endTime,
          });
          sendResponse({ success: true });
          break;

        case "GET_STATS":
          const stats = await calculateStats();
          sendResponse({ success: true, data: stats });
          break;

        case "CHECK_BLACKLIST":
          const blacklist = await getBlacklist();
          const isBlacklisted = isUrlBlacklisted(request.url, blacklist);
          sendResponse({ success: true, isBlacklisted });
          break;

        default:
          sendResponse({ success: false, error: "Unknown message type" });
      }
    } catch (error) {
      sendResponse({ success: false, error: (error as Error).message });
    }
  })();

  return true; // Keep message channel open for async response
});

// Calculate basic stats
async function calculateStats() {
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const history = await chrome.history.search({
    text: "",
    maxResults: 10000,
    startTime: oneWeekAgo,
  });

  const domains = new Set<string>();
  const hourlyDistribution = new Array(24).fill(0);

  history.forEach((item) => {
    try {
      const url = new URL(item.url || "");
      domains.add(url.hostname);
    } catch {
      // Invalid URL
    }

    if (item.lastVisitTime) {
      const hour = new Date(item.lastVisitTime).getHours();
      hourlyDistribution[hour]++;
    }
  });

  return {
    total: history.length,
    domains: domains.size,
    hourlyDistribution,
  };
}

// Periodic cleanup of old data (if auto-cleanup is enabled)
chrome.alarms?.onAlarm?.addListener(async (alarm) => {
  if (alarm.name === "cleanup-old-history") {
    // This could be expanded to support automatic cleanup based on user settings
    console.log("BrowseBuddy: Periodic cleanup check");
  }
});

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
    if (info.menuItemId === "add-to-blacklist" && tab?.url) {
      try {
        const url = new URL(tab.url);
        chrome.runtime.sendMessage({
          type: "ADD_DOMAIN_TO_BLACKLIST",
          domain: url.hostname,
        });
      } catch {
        // Invalid URL
      }
    }
  });
}
