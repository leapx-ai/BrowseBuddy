import type { 
  HistoryItem, 
  DeleteOptions, 
  SearchOptions, 
  DomainStats,
  TimeDistribution,
  Statistics,
  CalendarData,
  BlacklistEntry,
} from '../types';
import { filterBlacklistedItems, extractMainDomain } from './blacklist';

// Re-export types for convenience
export type { 
  HistoryItem, 
  DeleteOptions, 
  SearchOptions, 
  DomainStats,
  TimeDistribution,
  Statistics,
  CalendarData,
} from '../types';

// Fetch history from browser
export async function fetchHistory(options: SearchOptions = {}): Promise<HistoryItem[]> {
  const { keyword, dateRange, domains, maxResults = 10000, transitionType } = options;
  
  return new Promise((resolve, reject) => {
    const query: chrome.history.HistoryQuery = {
      text: keyword || '',
      maxResults,
      startTime: dateRange?.start,
      endTime: dateRange?.end,
    };

    chrome.history.search(query, async (results) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }

      let items: HistoryItem[] = results.map(item => ({
        id: `${item.visitCount}-${item.lastVisitTime}`,
        url: item.url || '',
        title: item.title || '',
        visitTime: item.lastVisitTime || 0,
        visitCount: item.visitCount || 0,
        typedCount: item.typedCount,
        lastVisitTime: item.lastVisitTime,
      }));

      // Filter by domains if specified
      if (domains && domains.length > 0) {
        items = items.filter(item => {
          try {
            const url = new URL(item.url);
            return domains.some(domain => url.hostname.includes(domain));
          } catch {
            return false;
          }
        });
      }

      // Filter by transition type if specified.
      // Requires a getVisits() round-trip per record, so only runs when requested.
      if (transitionType) {
        const enriched = await Promise.all(
          items.map(async (item) => {
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

        items = enriched.filter(item => {
          if (!item.transition) return false;
          return item.transition === transitionType;
        });
      }

      resolve(items);
    });
  });
}

// Fetch history excluding blacklisted domains (for display/export purposes)
export async function fetchVisibleHistory(
  options: SearchOptions = {},
  blacklist: BlacklistEntry[]
): Promise<HistoryItem[]> {
  const items = await fetchHistory(options);
  return filterBlacklistedItems(items, blacklist);
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

// Delete history entries (favorited domains are protected)
export async function deleteHistory(options: DeleteOptions): Promise<number> {
  const items = await fetchHistoryForDelete(options);
  const protectedItems = await filterFavoritedItems(items);
  let deletedCount = 0;

  for (const item of protectedItems) {
    try {
      await new Promise<void>((resolve, reject) => {
        chrome.history.deleteUrl({ url: item.url }, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        });
      });
      deletedCount++;
    } catch {
      // Continue with next item
    }
  }

  return deletedCount;
}

// Preview items to be deleted (favorited domains are protected)
export async function previewDelete(options: DeleteOptions): Promise<HistoryItem[]> {
  const items = await fetchHistoryForDelete(options);
  return filterFavoritedItems(items);
}

async function fetchHistoryForDelete(options: DeleteOptions): Promise<HistoryItem[]> {
  const searchOptions: SearchOptions = {
    maxResults: 10000,
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

  let items = await fetchHistory(searchOptions);

  // Apply regex filter if specified
  if (options.regex) {
    const regex = new RegExp(options.regex, 'i');
    items = items.filter(item => regex.test(item.url));
  }

  return items;
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

// Get all history domains
export async function getAllDomains(): Promise<string[]> {
  const items = await fetchHistory({ maxResults: 10000 });
  const domains = new Set<string>();
  
  items.forEach(item => {
    try {
      const url = new URL(item.url);
      domains.add(url.hostname);
    } catch {
      // Invalid URL, skip
    }
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
    await fetchHistory({ maxResults: 10000, dateRange }),
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

  // Domain stats
  const domainMap = new Map<string, DomainStats>();
  items.forEach(item => {
    try {
      const url = new URL(item.url);
      const domain = url.hostname;
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

  // Daily stats
  const dateMap = new Map<string, number>();
  items.forEach(item => {
    const date = new Date(item.visitTime).toISOString().split('T')[0];
    dateMap.set(date, (dateMap.get(date) || 0) + 1);
  });

  const dailyStats = Array.from(dateMap.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

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

// Get calendar data
export async function getCalendarData(year: number, month: number): Promise<CalendarData[]> {
  const startDate = new Date(year, month, 1);
  const endDate = new Date(year, month + 1, 0);
  
  const items = await fetchHistory({
    dateRange: {
      start: startDate.getTime(),
      end: endDate.getTime(),
    },
    maxResults: 10000,
  });

  // Count by date
  const dateMap = new Map<string, number>();
  items.forEach(item => {
    const date = new Date(item.visitTime).toISOString().split('T')[0];
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
    <p><strong>Period:</strong> ${new Date(stats.dateRange.earliest).toLocaleDateString()} - ${new Date(stats.dateRange.latest).toLocaleDateString()}</p>
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
