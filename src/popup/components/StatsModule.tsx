import React, { useState, useEffect, useCallback } from 'react';
import { getMessage, formatNumber, formatDuration, getCurrentLocale } from '../../utils/i18n';
import { computeStatistics, fetchAllHistory, exportToCsv, exportToHtml, downloadFile, type Statistics } from '../../utils/history';
import { filterBlacklistedItems } from '../../utils/blacklist';
import { getBlacklist, getVisibleDomainDurations } from '../../utils/storage';
import { Icon } from './Icon';
import type { DomainStats, TimeDistribution, DailyStats, BlacklistEntry, HistoryItem } from '../../types';
import { useSlowLoading } from '../useSlowLoading';

// Bar for charts with a hover tooltip. `label` is the tooltip line 1,
// `subLabel` an optional second line, `value` the prominent number.
const ChartBar: React.FC<{
  heightPct: number;
  color: string;
  label: string;
  value: string;
  subLabel?: string;
  showAxis?: string;
}> = ({ heightPct, color, label, value, subLabel, showAxis }) => {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="chart-col"
      // The tooltip is mouse-only, so without this the whole chart is invisible
      // to a screen reader. role="img" plus a label is readable in browse mode
      // and, unlike tabIndex on every bar, does not add 54 tab stops to a popup.
      role="img"
      aria-label={`${label}: ${value}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Chart drawing area - bars are % of this area, excluding the axis row */}
      <div className="chart-plot">
        {hovered && (
          <div className="chart-tooltip">
            <div className="tooltip-value">{value}</div>
            <div>{label}</div>
            {subLabel && <div className="tooltip-sub">{subLabel}</div>}
          </div>
        )}
        <div
          className="chart-bar"
          // Height and colour are data; the hover emphasis lives in CSS.
          style={{ height: `${Math.max(heightPct, 2)}%`, background: color }}
        />
      </div>
      {/* Fixed axis row - same height whether or not a label is present */}
      <div className="chart-axis">
        {showAxis && <div className="chart-axis-label">{showAxis}</div>}
      </div>
    </div>
  );
};

type RangeKey = 'all' | '7' | '30' | '90';

// Ranked list of domains with a bar. Both leaderboards on this screen were the
// same 10-row block spelled out twice; at ~34px a row that is 680px of scrolling
// before the charts. Five rows fit the panel, the rest is one click away.
const RANK_LIMIT = 5;

const RankedDomains: React.FC<{
  rows: { domain: string; value: number; ratio: number; display: string }[];
  accent: string;
  secondaryFill?: boolean;
}> = ({ rows, accent, secondaryFill }) => {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, RANK_LIMIT);

  return (
    <div className="rank-list">
      {visible.map((row, index) => (
        <div key={row.domain} className="rank-row">
          <span
            className="rank-index"
            style={{ background: index < 3 ? accent : 'var(--bg-tertiary)' }}
          >
            {index + 1}
          </span>
          <div className="rank-body">
            <div className="rank-domain truncate">
              {row.domain}
            </div>
            <div className="progress-bar is-thin">
              <div
                className={`progress-fill ${secondaryFill ? 'progress-fill-secondary' : ''}`}
                style={{ width: `${row.ratio * 100}%` }}
              />
            </div>
          </div>
          <span className="rank-value">
            {row.display}
          </span>
        </div>
      ))}
      {rows.length > RANK_LIMIT && (
        <button className="list-expander" onClick={() => setExpanded(v => !v)} aria-expanded={expanded}>
          {expanded ? getMessage('collapseList') : getMessage('showAllCount', String(rows.length))}
        </button>
      )}
    </div>
  );
};

const RANGE_OPTIONS: { key: RangeKey; days?: number }[] = [
  { key: 'all' },
  { key: '7', days: 7 },
  { key: '30', days: 30 },
  { key: '90', days: 90 },
];

const StatsModule: React.FC = () => {
  const [stats, setStats] = useState<Statistics | null>(null);
  // The items the panel was built from, kept so both exports reuse them.
  // Fetching them again per export meant a CSV-then-HTML download walked the
  // whole history three times, and the HTML report's "Total Records" header
  // (range-scoped) disagreed with the all-time rows printed below it.
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [blacklist, setBlacklist] = useState<BlacklistEntry[]>([]);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [range, setRange] = useState<RangeKey>('all');
  // Both exports are instant now, but a second click while the first download
  // is being assembled would still produce a duplicate file.
  const [isExporting, setIsExporting] = useState(false);
  const showSlowLoading = useSlowLoading(isLoading);

  const loadStats = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await getBlacklist();
      setBlacklist(list);
      const option = RANGE_OPTIONS.find(o => o.key === range);
      const dateRange = option?.days
        ? { start: Date.now() - option.days * 24 * 60 * 60 * 1000, end: Date.now() }
        : undefined;
      // Paginated so the "all time" range is not truncated by
      // chrome.history.search's per-query limit, which would zero out older days.
      const visible = filterBlacklistedItems(
        await fetchAllHistory({ maxResults: 20000, dateRange }),
        list
      );
      setItems(visible);
      setStats(computeStatistics(visible));
      const durationData = await getVisibleDomainDurations();
      setDurations(durationData);
    } catch (error) {
      console.error('Failed to load stats:', error);
    } finally {
      setIsLoading(false);
    }
  }, [range]);

  useEffect(() => {
    loadStats();
  }, [range, loadStats]);

  const handleExportCSV = async () => {
    if (!stats || isExporting) return;
    setIsExporting(true);
    try {
      const csv = exportToCsv(items);
      downloadFile(csv, `browsebuddy-history-${new Date().toISOString().split('T')[0]}.csv`, 'text/csv');
    } catch (error) {
      console.error('Failed to export CSV:', error);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportHTML = async () => {
    if (!stats || isExporting) return;
    setIsExporting(true);
    try {
      const html = exportToHtml(items, stats, durations);
      downloadFile(html, `browsebuddy-report-${new Date().toISOString().split('T')[0]}.html`, 'text/html');
    } catch (error) {
      console.error('Failed to export HTML:', error);
    } finally {
      setIsExporting(false);
    }
  };

  // Keep the previous numbers on screen while a new range loads. Unmounting
  // everything for a few milliseconds made the range switcher itself disappear.
  if (!stats) {
    return showSlowLoading ? (
      <div className="loading">
        <div className="spinner" />
        {getMessage('loading')}
      </div>
    ) : null;
  }

  if (stats.totalRecords === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon"><Icon name="chart" size={40} /></div>
        <div className="empty-title">{getMessage('noDataAvailable')}</div>
        <div className="empty-desc">
          {blacklist.length > 0 ? getMessage('allFilteredByBlacklist') : getMessage('startBrowsing')}
        </div>
      </div>
    );
  }

  const activeDays = stats.dailyStats.filter((d: DailyStats) => d.count > 0).length;
  const avgPerActiveDay = Math.round(stats.totalRecords / Math.max(activeDays, 1));

  const maxDuration = Math.max(...Object.values(durations), 1);
  const durationRows = Object.entries(durations)
    .sort((a, b) => b[1] - a[1])
    .map(([domain, ms]) => ({
      domain,
      value: ms,
      ratio: ms / maxDuration,
      display: formatDuration(Math.round(ms / 1000)),
    }));

  return (
    <div>
      {/* Time range switcher */}
      <div className="segmented">
        {RANGE_OPTIONS.map(opt => (
          <button
            key={opt.key}
            className={`segmented-item ${range === opt.key ? 'active' : ''}`}
            onClick={() => setRange(opt.key)}
          >
            {getMessage(`range_${opt.key}`)}
          </button>
        ))}
      </div>

      {/*
        Numbers stay on screen while a new range loads, so stale data is
        indistinguishable from fresh data. is-stale dims it, the same signal the
        browse list uses. The range switcher stays outside the wrapper because
        is-stale also blocks pointer events, and switching range is exactly what
        the user may want to do while a slow range is still loading.
      */}
      <div className={showSlowLoading ? 'is-stale' : undefined}>
        {/* Stats Overview */}
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">{formatNumber(stats.totalRecords)}</div>
            <div className="stat-label">{getMessage('totalRecords')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{formatNumber(stats.totalDomains)}</div>
            <div className="stat-label">{getMessage('domainsVisited')}</div>
          </div>
          {/*
            Totals alone do not say whether the range was one heavy day or spread
            out. Active days and the per-active-day average come out of dailyStats,
            which is already computed - averaging over calendar days instead would
            be diluted by every day the browser was not used.
          */}
          <div className="stat-card">
            <div className="stat-value">{formatNumber(activeDays)}</div>
            <div className="stat-label">{getMessage('activeDays')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{formatNumber(avgPerActiveDay)}</div>
            <div className="stat-label">{getMessage('avgPerActiveDay')}</div>
          </div>
        </div>

        {/* Top Sites */}
        <div className="card">
          <h3 className="card-title">{getMessage('topSites')}</h3>
          <RankedDomains
            accent="var(--primary-color)"
            rows={stats.topSites.map((site: DomainStats) => ({
              domain: site.domain,
              value: site.count,
              ratio: site.count / Math.max(stats.topSites[0].count, 1),
              display: formatNumber(site.count),
            }))}
          />
        </div>

        {/* Top Sites by Dwell Time */}
        {durationRows.length > 0 && (
          <div className="card">
            <h3 className="card-title">
              {getMessage('topSitesByTime')}
              {range !== 'all' && (
                <span className="card-title-note">
                  {getMessage('lifetimeAccumulated')}
                </span>
              )}
            </h3>
            <RankedDomains accent="var(--secondary-color)" secondaryFill rows={durationRows} />
          </div>
        )}

        {/* Time Distribution */}
        <div className="card">
          <h3 className="card-title">{getMessage('timeDistribution')}</h3>
          <div className="chart-row chart-row-hours">
            {stats.timeDistribution.map((hour: TimeDistribution) => {
              const maxCount = Math.max(...stats.timeDistribution.map((h: TimeDistribution) => h.count), 1);
              const height = (hour.count / maxCount) * 100;
              return (
                <ChartBar
                  key={hour.hour}
                  heightPct={height}
                  color="var(--primary-color)"
                  value={formatNumber(hour.count)}
                  label={getMessage('hourLabel', `${hour.hour}:00` )}
                  subLabel={getMessage('visitsInHour')}
                  showAxis={hour.hour % 6 === 0 ? `${hour.hour}` : undefined}
                />
              );
            })}
          </div>
        </div>

        {/* Daily Trend (Last 30 days) */}
        {stats.dailyStats.length > 0 && (
          <div className="card">
            {/*
              The window used to be spelled out in a centred caption under the
              chart; as part of the title it is the same fact in ~35px less space,
              and the axis labels plus the hover tooltip already carry the rest of
              what the caption repeated.
            */}
            <h3 className="card-title">
              {getMessage('dailyTrend')}
              <span className="card-title-note">
                {getMessage('range_30')}
              </span>
            </h3>
            <div className="chart-row chart-row-days">
              {stats.dailyStats.slice(-30).map((day: DailyStats, index: number, arr: DailyStats[]) => {
                const maxCount = Math.max(...stats.dailyStats.map((d: DailyStats) => d.count), 1);
                const height = (day.count / maxCount) * 100;
                const d = new Date(day.date + 'T00:00:00');
                const weekday = d.toLocaleDateString(getCurrentLocale().replace('_', '-'), { weekday: 'short' });
                // Show axis label on first, middle and last bar
                const isFirst = index === 0;
                const isLast = index === arr.length - 1;
                const isMiddle = index === Math.floor(arr.length / 2);
                const showAxis = isFirst || isMiddle || isLast
                  ? d.toLocaleDateString(getCurrentLocale().replace('_', '-'), { month: 'numeric', day: 'numeric' })
                  : undefined;
                return (
                  <ChartBar
                    key={day.date}
                    heightPct={height}
                    color="var(--secondary-color)"
                    value={formatNumber(day.count)}
                    label={day.date}
                    subLabel={weekday}
                    showAxis={showAxis}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/*
          Two buttons do not need a card and a heading to announce themselves - the
          icons and labels already say "download". That wrapper was ~50px.
          While an export runs the icon becomes a spinner and both buttons go
          disabled: the work happens in the background with no other feedback, so
          a still button reads as "nothing happened" and invites a second click.
        */}
        <div className="btn-row">
          <button className="btn btn-primary btn-sm" onClick={handleExportCSV} disabled={isExporting}>
            {isExporting ? (
              <div className="spinner is-sm" />
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
            )}
            {getMessage('exportCSV')}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleExportHTML} disabled={isExporting}>
            {isExporting ? (
              <div className="spinner is-sm" />
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
            )}
            {getMessage('exportHTML')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default StatsModule;
