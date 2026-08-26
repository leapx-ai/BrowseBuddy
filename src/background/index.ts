import {
  getSettings,
  getBlacklist,
  isUrlBlacklisted,
  saveBlacklist,
  addUrlToBlacklist,
  addDwellTime,
  cleanupOldHistory,
} from "../utils/storage";
import { extractMainDomain, isInternalUrl } from "../utils/blacklist";
import { getMessage, initI18n } from "../utils/i18n";

// Track active tab times for duration calculation
interface TabInfo {
  url: string;
  startTime: number;
}

const activeTabs = new Map<number, TabInfo>();

// Whether a URL's dwell time may be recorded at all.
//
// Both settle paths below carried their own copy of this test, so a change to
// one silently left the other counting time the user had asked not to be
// counted.
async function mayRecordDwellTime(url: string): Promise<boolean> {
  if (isInternalUrl(url)) return false;
  const [settings, blacklist] = await Promise.all([getSettings(), getBlacklist()]);
  if (settings.sessionIncognito) return false;
  return !isUrlBlacklisted(url, blacklist);
}

// Settle the accumulated time for a tab and merge it into the domain totals.
async function settleTabDuration(tabId: number) {
  const tab = activeTabs.get(tabId);
  if (!tab) return;

  activeTabs.delete(tabId);

  const elapsed = Date.now() - tab.startTime;
  if (elapsed < 1000) return; // ignore sub-second flashes

  const domain = extractMainDomain(tab.url);
  if (!domain) return;

  if (!(await mayRecordDwellTime(tab.url))) return;

  await addDwellTime(domain, elapsed);
}

// Periodically persist the currently-active tab's running time so it is not
// lost if the service worker is terminated (MV3 swarms sleep aggressively).
// This does NOT finalize the tab - it snapshots elapsed time into the totals
// and resets the start time, keeping the tab "still active" for timing.
async function persistActiveTabDuration() {
  for (const tab of activeTabs.values()) {
    const elapsed = Date.now() - tab.startTime;
    if (elapsed < 1000) continue;

    const domain = extractMainDomain(tab.url);
    if (!domain) continue;

    if (!(await mayRecordDwellTime(tab.url))) continue;

    // Reset the snapshot point so we don't double count next time
    tab.startTime = Date.now();
    await addDwellTime(domain, elapsed);
  }
}

// One-time-per-browser-session setup.
//
// This used to run at module scope, i.e. on every service worker wake - and MV3
// wakes the worker on any tab update or any visit, so it re-ran constantly. That
// is what forced ensureAlarm() to exist: chrome.alarms.create() with an existing
// name restarts the period from zero, so the daily auto-cleanup alarm had its
// 24-hour countdown reset long before it could ever fire.
//
// onStartup fires once when the browser launches; onInstalled covers install and
// update, where the alarm set may genuinely need rebuilding. Alarms and the
// badge both outlive the worker, so nothing here needs to run on a plain wake.
async function initialize() {
  const settings = await getSettings();
  syncIncognitoBadge(settings.sessionIncognito);
  syncAutoCleanupAlarm(settings.autoCleanup);
  ensureDwellSnapshotAlarm();
  clearRetiredAlarms();
}

chrome.runtime.onStartup?.addListener(() => {
  initialize().catch(error => {
    console.error('BrowseBuddy: startup initialization failed', error);
  });
});

// Create a periodic alarm only if it does not already exist.
//
// chrome.alarms.create() with an existing name replaces the alarm and restarts
// its period from zero. These helpers run on every service worker wake, and MV3
// wakes the worker constantly (any tab update, any visit), so the daily
// auto-cleanup alarm had its 24-hour countdown reset long before it could ever
// fire. Checking first lets an existing schedule keep running.
async function ensureAlarm(name: string, periodInMinutes: number) {
  if (!chrome.alarms) return;
  const existing = await chrome.alarms.get(name);
  if (existing) return;
  chrome.alarms.create(name, { periodInMinutes });
}

// Run a per-minute snapshot alarm so dwell time is never lost to SW restarts.
function ensureDwellSnapshotAlarm() {
  ensureAlarm("dwell-snapshot", 1);
}

// The auto-backup feature is gone (it only ever wrote a copy of storage into
// storage, which nothing read). Existing installs still have its alarm
// registered, so retire it explicitly rather than leaving it firing.
function clearRetiredAlarms() {
  if (!chrome.alarms) return;
  chrome.alarms.clear("auto-backup");
}

// Manage the auto-cleanup alarm. Runs daily when enabled.
function syncAutoCleanupAlarm(enabled: boolean) {
  if (!chrome.alarms) return;

  if (enabled) {
    ensureAlarm("auto-cleanup", 24 * 60);
  } else {
    chrome.alarms.clear("auto-cleanup");
  }
}

// Install / update. One listener, not three: onInstalled was registered here
// and again at the bottom of the file for the context menu, so the two halves of
// "set the extension up" were 200 lines apart and neither knew about the other.
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    // First install - show welcome page
    chrome.tabs.create({
      url: chrome.runtime.getURL("options.html?welcome=true"),
    });

    // Initialize empty blacklist (no default entries)
    await saveBlacklist([]);
  }

  // Context menu definitions do not survive an update, so recreate on both
  // install and update rather than only on first install.
  createContextMenu();

  // Alarms may need rebuilding after an update, and on first install they do
  // not exist yet.
  await initialize();
});

// One tabs.onUpdated listener. There were two - blacklist enforcement here and
// dwell-time settling 110 lines below - which fired concurrently on the same
// event and disagreed about what counts as a page: the enforcement half ignored
// nothing, while the dwell half re-armed the timer even for chrome:// URLs that
// onActivated deliberately skips.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url || !tab.url) return;
  const url = tab.url;

  // Enforcement first: it is the privacy-critical half and should not wait on a
  // storage write.
  await enforceOnNavigation(tabId, url);

  // The old URL's dwell time ends here; the new one starts now.
  if (activeTabs.has(tabId)) {
    await settleTabDuration(tabId);
    if (!isInternalUrl(url)) {
      activeTabs.set(tabId, { url, startTime: Date.now() });
    }
  }
});

async function enforceOnNavigation(tabId: number, url: string) {
  let blacklist;
  try {
    blacklist = await getBlacklist();
  } catch (error) {
    // Same reasoning as the onVisited handler below: an unreadable blacklist is
    // reported, never treated as "nothing is blacklisted". This half used to let
    // the rejection escape into an unhandled promise instead.
    console.error(
      'BrowseBuddy: blacklist unavailable, this navigation was not screened',
      error
    );
    return;
  }

  if (!isUrlBlacklisted(url, blacklist)) return;

  const settings = await getSettings();

  // Remove this URL from history if real-time protection is enabled
  if (settings.realtimeProtection) {
    try {
      await chrome.history.deleteUrl({ url });
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

  let blacklist;
  try {
    blacklist = await getBlacklist();
  } catch (error) {
    // The blacklist could not be read, so whether this visit is protected is
    // unknown. Deleting on a guess would destroy history the user wanted to
    // keep, so the visit is left alone - but the failure is reported instead of
    // degrading protection to "off" in silence, which is what getBlacklist's
    // swallowed `catch { return [] }` used to do.
    console.error(
      'BrowseBuddy: blacklist unavailable, this visit was not screened',
      error
    );
    return;
  }

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

  if (tab.url && !isInternalUrl(tab.url)) {
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

// When a window loses focus (e.g. user switches to another app), finalize the
// running time of all tracked tabs. On refocus the next onActivated/onUpdated
// will re-record them.
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Browser lost focus - settle everything
    for (const tabId of Array.from(activeTabs.keys())) {
      settleTabDuration(tabId);
    }
  }
});

// One alarm listener. Two were registered, each ignoring the other's alarm
// name, so adding a third periodic task meant guessing which block owned it.
chrome.alarms?.onAlarm?.addListener(async (alarm) => {
  if (alarm.name === "dwell-snapshot") {
    await persistActiveTabDuration();
    return;
  }

  if (alarm.name === "auto-cleanup") {
    const settings = await getSettings();
    if (settings.autoCleanup) {
      cleanupOldHistory(settings.cleanupRetentionDays).catch(() => {});
    }
  }
});

// Keep the toolbar badge, the auto-cleanup alarm and the context menu's language
// in sync with settings changes. storage.onChanged is the only channel the UI has
// to reach the worker, so everything the worker mirrors from settings is handled
// here.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.browsebuddy_settings) return;

  const settings = changes.browsebuddy_settings.newValue;
  if (!settings) return;

  syncIncognitoBadge(settings.sessionIncognito);
  syncAutoCleanupAlarm(settings.autoCleanup);

  const previousLanguage = changes.browsebuddy_settings.oldValue?.language;
  if (settings.language !== previousLanguage) {
    createContextMenu();
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

// Context menu. The title was hard-coded English even though the extension
// ships with default_locale zh_CN, so a Chinese install got one English item in
// its right-click menu. It goes through the same message bundle as the UI, which
// also means it has to be rebuilt when the language setting changes.
async function createContextMenu() {
  if (typeof chrome === "undefined" || !chrome.contextMenus) return;
  try {
    await initI18n();
    await chrome.contextMenus.removeAll?.();
    chrome.contextMenus.create({
      id: "add-to-blacklist",
      title: getMessage("addToBlacklist"),
      contexts: ["page", "link"],
    });
  } catch (error) {
    // Menu might already exist or API not available
    console.log("BrowseBuddy: Context menu creation skipped", error);
  }
}

chrome.contextMenus?.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "add-to-blacklist") return;
  const targetUrl = info.linkUrl || info.pageUrl || tab?.url;
  if (!targetUrl) return;
  try {
    const url = new URL(targetUrl);
    // Blacklist only. Passing `true` here deleted every history record for the
    // domain with no confirmation dialog, no reported count and no way back,
    // from a single right-click. Existing history is removed from the privacy
    // page, where the choice is presented and confirmed.
    await addUrlToBlacklist(url.hostname, false);
  } catch {
    // Invalid URL
  }
});
