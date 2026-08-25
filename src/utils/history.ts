import type { 
  HistoryItem, 
  DeleteOptions, 
  SearchOptions, 
  DomainStats,
  TimeDistribution,
  DailyStats,
  Statistics,
  CalendarData,
  BlacklistEntry,
} from '../types';
import { filterBlacklistedItems, extractMainDomain, hostMatchesDomain } from './blacklist';

// Re-export types for convenience
export type { 
  HistoryItem, 
  DeleteOptions, 
  SearchOptions, 
  DomainStats,
  TimeDistribution,
  DailyStats,
  Statistics,
  CalendarData,
} from '../types';

// "YYYY-MM-DD" in the user's own timezone. toISOString() resolves to the UTC
// day, which puts an evening visit in UTC+8 on the previous date.
function toLocalDateKey(ts: number): string {
  const d = new Date(ts);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

// Fetch history from browser
// Raw chrome.history.search wrapper. Deliberately unfiltered: paginating
// callers must advance their cursor over the *unfiltered* result set, otherwise
// a page whose every record is filtered out looks like "end of history".
function searchHistoryRaw(options: SearchOptions = {}): Promise<HistoryItem[]> {
  const { keyword, dateRange, maxResults = 10000 } = options;

  return new Promise((resolve, reject) => {
    const query: chrome.history.HistoryQuery = {
      text: keyword || '',
      maxResults,
      startTime: dateRange?.start,
      endTime: dateRange?.end,
    };

    chrome.history.search(query, (results) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }

      resolve(results.map(item => ({
        id: `${item.visitCount}-${item.lastVisitTime}`,
        url: item.url || '',
        title: item.title || '',
        visitTime: item.lastVisitTime || 0,
        visitCount: item.visitCount || 0,
        typedCount: item.typedCount,
        lastVisitTime: item.lastVisitTime,
      })));
    });
  });
}

// Post-search filters that chrome.history.search cannot express itself.
async function applySearchFilters(
  items: HistoryItem[],
  options: Pick<SearchOptions, 'domains' | 'transitionType'>
): Promise<HistoryItem[]> {
  const { domains, transitionType } = options;
  let result = items;

  // Exact-or-subdomain, never substring: "test.com" must not match
  // "latest.com", otherwise a scoped delete silently becomes a wider one.
  if (domains && domains.length > 0) {
    result = result.filter(item => {
      try {
        const url = new URL(item.url);
        return domains.some(domain => hostMatchesDomain(url.hostname, domain));
      } catch {
        return false;
      }
    });
  }

  // Requires a getVisits() round-trip per record, so only runs when requested.
  if (transitionType) {
    const enriched = await Promise.all(
      result.map(async (item) => {
        try {
          const visits = await chrome.history.getVisits({ url: item.url });
          // Pick the most recent visit's transition
          const sorted = [...visits].sort((a, b) => (b.visitTime || 0) - (a.visitTime || 0));
          return { ...item, transition: sorted[0]?.transition };
        } catch {
          return { ...item, transition: undefined };
        }
      })
    );

    result = enriched.filter(item => item.transition === transitionType);
  }

  return result;
}

// Fetch history from browser
export async function fetchHistory(options: SearchOptions = {}): Promise<HistoryItem[]> {
  const raw = await searchHistoryRaw(options);
  return applySearchFilters(raw, options);
}

// Fetch history excluding blacklisted domains (for display/export purposes)
export async function fetchVisibleHistory(
  options: SearchOptions = {},
  blacklist: BlacklistEntry[]
): Promise<HistoryItem[]> {
  const items = await fetchHistory(options);
  return filterBlacklistedItems(items, blacklist);
}

// Fetch the full history within a range by walking backwards page by page.
// chrome.history.search caps each query at `maxResults` (defaulting to the
// most recent N records), so a single query would silently drop older entries
// and skew statistics (e.g. older days showing zero visits).
export async function fetchAllHistory(
  options: SearchOptions = {}
): Promise<HistoryItem[]> {
  // Every filter must be forwarded to each page. Dropping `domains` here used
  // to turn a domain-scoped delete into a delete of the entire history.
  const { keyword, dateRange, domains, transitionType, maxResults = 10000 } = options;
  const PAGE_SIZE = 2000;

  const all: HistoryItem[] = [];
  const seen = new Set<string>();
  // Cursor progress is tracked on the *unfiltered* results. If it were tracked
  // on the filtered ones, a page where nothing matches `domains` would look
  // identical to "no history left" and pagination would stop early.
  const seenRaw = new Set<string>();
  // Walk backwards from the range end (or now) so pagination is deterministic.
  // chrome.history.search's endTime is exclusive ("visited before this date"),
  // so advancing to the earliest visit time neither repeats nor skips records.
  let endTime = dateRange?.end ?? Date.now();
  let pages = 0;
  const MAX_PAGES = 50;

  while (all.length < maxResults && pages < MAX_PAGES) {
    const raw = await searchHistoryRaw({
      keyword,
      maxResults: PAGE_SIZE,
      dateRange: { start: dateRange?.start ?? 0, end: endTime },
    });

    if (raw.length === 0) break;

    // Advance cursor to the earliest visit time in this page, and detect a
    // cursor that is no longer moving (nothing new came back).
    let newRaw = 0;
    let earliest = Infinity;
    for (const item of raw) {
      const key = `${item.url}:${item.lastVisitTime}`;
      if (!seenRaw.has(key)) {
        seenRaw.add(key);
        newRaw++;
      }
      if (item.lastVisitTime && item.lastVisitTime < earliest) {
        earliest = item.lastVisitTime;
      }
    }

    if (newRaw === 0) break;

    const page = await applySearchFilters(raw, { domains, transitionType });

    // De-duplicate (same URL + timestamp can appear on page boundaries)
    for (const item of page) {
      const key = `${item.url}:${item.lastVisitTime}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(item);
      // Stop exactly at the requested limit
      if (all.length >= maxResults) break;
    }

    // Fewer records than a full page means the range is exhausted.
    if (raw.length < PAGE_SIZE) break;
    if (!Number.isFinite(earliest)) break;

    endTime = earliest;
    pages++;
  }

  return all;
}

// Remove items whose main domain is favorited (protected from deletion).
async function filterFavoritedItems(items: HistoryItem[]): Promise<HistoryItem[]> {
  if (items.length === 0) return items;
  const { getFavorites } = await import('./storage');
  const favorites = await getFavorites();
  if (favorites.length === 0) return items;
  return items.filter(item => {
    const mainDomain = extractMainDomain(item.url);
    return !favorites.includes(mainDomain);
  });
}

// Remove items whose domain is blacklisted or favorited.
// Both protections use the same main-domain semantics as the blacklist.
async function filterDeleteItems(
  items: HistoryItem[],
  blacklist: BlacklistEntry[]
): Promise<HistoryItem[]> {
  if (items.length === 0) return items;
  const visible = filterBlacklistedItems(items, blacklist);
  return filterFavoritedItems(visible);
}

// Delete the exact items that were previewed.
// The previewed array is passed in rather than re-derived from the options:
// re-running the query here would also catch anything recorded while the user
// was reading the confirmation dialog, i.e. records they never saw.
// `dateRange` scopes the deletion to the window the user selected.
export async function deleteHistory(
  items: HistoryItem[],
  dateRange?: { start: number; end: number }
): Promise<number> {
  let deletedCount = 0;

  for (let i = 0; i < items.length; i++) {
    try {
      if (dateRange) {
        await deleteVisitsInRange(items[i].url, dateRange);
      } else {
        await deleteSingleUrl(items[i].url);
      }
      deletedCount++;
    } catch {
      // Continue with next item
    }
    // Yield periodically so a large deletion does not starve the event loop.
    if ((i + 1) % 20 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  return deletedCount;
}

// chrome.history offers no "delete these visits of this URL": deleteUrl erases
// every visit ever recorded for it, and deleteRange ignores the URL. Scope by
// time instead - read the URL's visits, keep the ones inside the requested
// window, and remove each with a narrow deleteRange.
//
// Caveat: a 2ms window can also catch a different URL visited in the same
// millisecond. That visit lies inside the range the user asked to clear, so the
// blast radius stays within the requested window - unlike deleteUrl, which
// reaches outside it by design.
async function deleteVisitsInRange(
  url: string,
  dateRange: { start: number; end: number }
): Promise<void> {
  const visits = await chrome.history.getVisits({ url });
  const inRange = visits
    .map(v => v.visitTime)
    .filter(
      (t): t is number =>
        typeof t === 'number' && t >= dateRange.start && t <= dateRange.end
    );

  if (inRange.length === 0) return;

  // Every visit falls inside the window, so one call removes the URL outright.
  if (inRange.length === visits.length) {
    await deleteSingleUrl(url);
    return;
  }

  for (const visitTime of inRange) {
    await new Promise<void>((resolve, reject) => {
      chrome.history.deleteRange(
        { startTime: visitTime - 1, endTime: visitTime + 1 },
        () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        }
      );
    });
  }
}

// Preview items to be deleted (blacklisted & favorited domains are protected)
export async function previewDelete(options: DeleteOptions): Promise<HistoryItem[]> {
  return fetchHistoryForDelete(options);
}

async function fetchHistoryForDelete(options: DeleteOptions): Promise<HistoryItem[]> {
  // Defence in depth: an options object with no criteria means "everything".
  // The UI guards against producing one, but this path deletes history, so it
  // refuses rather than trusting the caller.
  if (!options.dateRange && !options.domain && !options.keyword && !options.regex) {
    throw new Error('Refusing to target the entire history: no delete criteria given');
  }

  const searchOptions: SearchOptions = {
    maxResults: 20000,
  };

  if (options.dateRange) {
    searchOptions.dateRange = options.dateRange;
  }

  if (options.keyword) {
    searchOptions.keyword = options.keyword;
  }

  if (options.domain) {
    searchOptions.domains = [options.domain];
  }

  // Use paginated fetch so deletion is not truncated to the most recent 10k
  // records - otherwise old history matching the criteria would be skipped.
  let items = await fetchAllHistory(searchOptions);

  // Apply regex filter if specified
  if (options.regex) {
    const regex = new RegExp(options.regex, 'i');
    items = items.filter(item => regex.test(item.url));
  }

  // Apply protections (blacklist + favorites) so preview and actual
  // deletion always use the exact same item set.
  const { getBlacklist } = await import('./storage');
  const blacklist = await getBlacklist();
  return filterDeleteItems(items, blacklist);
}

// Delete single URL
export async function deleteSingleUrl(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.history.deleteUrl({ url }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

// Delete all history in a date range
export async function deleteHistoryInRange(startTime: number, endTime: number): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.history.deleteRange({ startTime, endTime }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

// Get all history domains (aggregated by main domain, matching stats/favorites)
export async function getAllDomains(): Promise<string[]> {
  const items = await fetchAllHistory({ maxResults: 20000 });
  const domains = new Set<string>();
  
  items.forEach(item => {
    const domain = extractMainDomain(item.url);
    if (domain) domains.add(domain);
  });

  return Array.from(domains).sort();
}

// Group history by date
export function groupByDate(items: HistoryItem[]): Map<string, HistoryItem[]> {
  const groups = new Map<string, HistoryItem[]>();
  
  items.forEach(item => {
    const date = new Date(item.visitTime).toISOString().split('T')[0];
    if (!groups.has(date)) {
      groups.set(date, []);
    }
    groups.get(date)!.push(item);
  });

  return groups;
}

// Group history by domain
export function groupByDomain(items: HistoryItem[]): Map<string, HistoryItem[]> {
  const groups = new Map<string, HistoryItem[]>();
  
  items.forEach(item => {
    try {
      const url = new URL(item.url);
      const domain = url.hostname;
      if (!groups.has(domain)) {
        groups.set(domain, []);
      }
      groups.get(domain)!.push(item);
    } catch {
      // Invalid URL, skip
    }
  });

  return groups;
}

// Group history by hour
export function groupByHour(items: HistoryItem[]): Map<number, HistoryItem[]> {
  const groups = new Map<number, HistoryItem[]>();
  
  items.forEach(item => {
    const hour = new Date(item.visitTime).getHours();
    if (!groups.has(hour)) {
      groups.set(hour, []);
    }
    groups.get(hour)!.push(item);
  });

  return groups;
}

// Calculate statistics
export async function calculateStatistics(
  blacklist: BlacklistEntry[] = [],
  dateRange?: { start: number; end: number }
): Promise<Statistics> {
  const items = filterBlacklistedItems(
    // Use paginated fetch so the "all time" range is not truncated by
    // chrome.history.search's per-query limit, which would zero out older days.
    await fetchAllHistory({ maxResults: 20000, dateRange }),
    blacklist
  );
  
  if (items.length === 0) {
    return {
      totalRecords: 0,
      totalDomains: 0,
      dateRange: { earliest: 0, latest: 0 },
      topSites: [],
      timeDistribution: [],
      dailyStats: [],
    };
  }

  // Domain stats - aggregate by main (registrable) domain so that
  // "www.example.com" and "example.com" count as the same site, matching the
  // granularity used by dwell-time stats.
  const domainMap = new Map<string, DomainStats>();
  items.forEach(item => {
    try {
      const domain = extractMainDomain(item.url);
      if (!domain) return;
      const existing = domainMap.get(domain);
      if (existing) {
        existing.count++;
        if (item.visitTime > existing.lastVisit) {
          existing.lastVisit = item.visitTime;
        }
      } else {
        domainMap.set(domain, {
          domain,
          count: 1,
          lastVisit: item.visitTime,
        });
      }
    } catch {
      // Invalid URL
    }
  });

  const topSites = Array.from(domainMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  // Time distribution (by hour)
  const hourCounts = new Array(24).fill(0);
  items.forEach(item => {
    const hour = new Date(item.visitTime).getHours();
    hourCounts[hour]++;
  });

  const timeDistribution: TimeDistribution[] = hourCounts.map((count, hour) => ({
    hour,
    count,
  }));

  // Daily stats - build a continuous timeline from the earliest to the
  // latest date, zero-filling days with no visits so the chart always shows
  // the full range rather than only dates that happen to have records.
  const dateCounts = new Map<string, number>();
  items.forEach(item => {
    const date = new Date(item.visitTime).toISOString().split('T')[0];
    dateCounts.set(date, (dateCounts.get(date) || 0) + 1);
  });

  const dailyStats: DailyStats[] = [];
  if (items.length > 0) {
    // Build the timeline in UTC so date keys match the `toISOString` keys
    // used when aggregating dateCounts, regardless of local timezone.
    const earliestTs = Math.min(...items.map(i => i.visitTime));
    const latestTs = Math.max(...items.map(i => i.visitTime));

    const startKey = new Date(earliestTs).toISOString().split('T')[0];
    const endKey = new Date(latestTs).toISOString().split('T')[0];

    const cursor = new Date(`${startKey}T00:00:00Z`);
    const end = new Date(`${endKey}T00:00:00Z`);

    while (cursor.getTime() <= end.getTime()) {
      const key = cursor.toISOString().split('T')[0];
      dailyStats.push({ date: key, count: dateCounts.get(key) || 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  // Date range
  const visitTimes = items.map(item => item.visitTime);
  const earliest = Math.min(...visitTimes);
  const latest = Math.max(...visitTimes);

  return {
    totalRecords: items.length,
    totalDomains: domainMap.size,
    dateRange: { earliest, latest },
    topSites,
    timeDistribution,
    dailyStats,
  };
}

// Get calendar data.
// Reads the blacklist itself rather than taking it as a parameter - this was the
// one read path that had no blacklist argument at all, so blacklisted domains
// were still shaded into the heat map and still skewed its normalization.
export async function getCalendarData(year: number, month: number): Promise<CalendarData[]> {
  const startDate = new Date(year, month, 1);
  // Last day of the month at 23:59:59.999 local. `new Date(year, month + 1, 0)`
  // alone is that day at 00:00, which excluded the whole final day of the month.
  const endDate = new Date(year, month + 1, 0, 23, 59, 59, 999);

  const items = await fetchAllHistory({
    dateRange: {
      start: startDate.getTime(),
      end: endDate.getTime(),
    },
    maxResults: 20000,
  });

  const { getBlacklist } = await import('./storage');
  const visible = filterBlacklistedItems(items, await getBlacklist());

  // Count by date. The keys must be *local* calendar dates because that is what
  // the calendar grid is built from; toISOString() resolves to the UTC day and
  // shifted evening visits into the previous cell.
  const dateMap = new Map<string, number>();
  visible.forEach(item => {
    const date = toLocalDateKey(item.visitTime);
    dateMap.set(date, (dateMap.get(date) || 0) + 1);
  });

  // Calculate max for intensity
  const maxCount = Math.max(...dateMap.values(), 1);

  return Array.from(dateMap.entries()).map(([date, count]) => ({
    date,
    count,
    intensity: count / maxCount,
  }));
}

// Export to CSV
export function exportToCsv(items: HistoryItem[]): string {
  const headers = ['Title', 'URL', 'Visit Time', 'Visit Count'];
  const rows = items.map(item => [
    `"${item.title.replace(/"/g, '""')}"`,
    `"${item.url}"`,
    new Date(item.visitTime).toISOString(),
    item.visitCount,
  ]);

  return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
}

// Export to HTML report
export function exportToHtml(
  items: HistoryItem[],
  stats: Statistics,
  durations?: Record<string, number>
): string {
  const grouped = groupByDate(items);

  const topSitesHtml = stats.topSites
    .slice(0, 10)
    .map((site, i) => `
    <div class="item">
      <span class="rank">${i + 1}</span>
      <span class="item-title">${site.domain}</span>
      <span class="item-count">${site.count} visits</span>
    </div>`)
    .join('');

  const topDurationHtml = durations && Object.keys(durations).length > 0
    ? Object.entries(durations)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([domain, ms], i) => `
    <div class="item">
      <span class="rank">${i + 1}</span>
      <span class="item-title">${domain}</span>
      <span class="item-count">${formatReportDuration(ms)}</span>
    </div>`)
        .join('')
    : '';

  const hourBars = stats.timeDistribution
    .map(h => `
    <div class="hbar" style="height:${Math.max(h.count > 0 ? (h.count / Math.max(...stats.timeDistribution.map(x => x.count), 1)) * 100 : 0, 2)}%;" title="${h.hour}:00 - ${h.count}"></div>`)
    .join('');

  const dailyBars = stats.dailyStats.slice(-30)
    .map(d => `
    <div class="hbar hbar-alt" style="height:${Math.max((d.count / Math.max(...stats.dailyStats.map(x => x.count), 1)) * 100, 2)}%;" title="${d.date} - ${d.count}"></div>`)
    .join('');

  let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>BrowseBuddy History Report</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
    h1 { color: #333; }
    h2 { color: #444; margin-top: 30px; }
    .stats { background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0; }
    .date-group { margin: 20px 0; }
    .date-header { background: #e0e0e0; padding: 10px; font-weight: bold; }
    .item { padding: 10px; border-bottom: 1px solid #eee; display: flex; gap: 10px; align-items: center; }
    .item-title { font-weight: bold; }
    .item-url { color: #666; font-size: 0.9em; }
    .item-time { color: #999; font-size: 0.85em; }
    .item-count { color: #777; margin-left: auto; }
    .rank { color: #999; width: 20px; }
    .chart { display: flex; align-items: flex-end; height: 100px; gap: 2px; margin: 10px 0; }
    .hbar { flex: 1; background: #6366f1; border-radius: 2px 2px 0 0; min-height: 2px; }
    .hbar-alt { background: #8b5cf6; }
  </style>
</head>
<body>
  <h1>BrowseBuddy History Report</h1>
  <div class="stats">
    <p><strong>Total Records:</strong> ${stats.totalRecords}</p>
    <p><strong>Total Domains:</strong> ${stats.totalDomains}</p>
    <p><strong>Period:</strong> ${stats.dateRange.earliest ? new Date(stats.dateRange.earliest).toLocaleDateString() : 'N/A'} - ${stats.dateRange.latest ? new Date(stats.dateRange.latest).toLocaleDateString() : 'N/A'}</p>
  </div>
  <h2>Top Sites</h2>
  ${topSitesHtml || '<p>No data</p>'}
  ${topDurationHtml ? `<h2>Most Time Spent</h2>${topDurationHtml}` : ''}
  <h2>Hourly Distribution</h2>
  <div class="chart">${hourBars || '<p>No data</p>'}</div>
  <h2>Daily Trend (Last 30 days)</h2>
  <div class="chart">${dailyBars || '<p>No data</p>'}</div>`;

  Array.from(grouped.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .forEach(([date, dateItems]) => {
      html += `
  <div class="date-group">
    <div class="date-header">${date} (${dateItems.length} items)</div>`;
      
      dateItems.forEach(item => {
        html += `
    <div class="item">
      <div class="item-title">${item.title || '(No title)'}</div>
      <div class="item-url">${item.url}</div>
      <div class="item-time">${new Date(item.visitTime).toLocaleString()}</div>
    </div>`;
      });
      
      html += `
  </div>`;
    });

  html += `
</body>
</html>`;

  return html;
}

// Format milliseconds into a human-readable duration for the HTML report
function formatReportDuration(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

// Download file
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
