import React, { useState, useEffect, useCallback } from 'react';
import { getMessage, formatNumber, formatDuration } from '../../utils/i18n';
import { calculateStatistics, fetchVisibleHistory, exportToCsv, exportToHtml, downloadFile, type Statistics } from '../../utils/history';
import { getBlacklist, getDomainDurations } from '../../utils/storage';
import type { DomainStats, TimeDistribution, DailyStats, BlacklistEntry } from '../../types';

type RangeKey = 'all' | '7' | '30' | '90';

const RANGE_OPTIONS: { key: RangeKey; label: string; days?: number }[] = [
  { key: 'all', label: '全部' },
  { key: '7', label: '近7天', days: 7 },
  { key: '30', label: '近30天', days: 30 },
  { key: '90', label: '近90天', days: 90 },
];

const StatsModule: React.FC = () => {
  const [stats, setStats] = useState<Statistics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [blacklist, setBlacklist] = useState<BlacklistEntry[]>([]);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [range, setRange] = useState<RangeKey>('all');

  const loadStats = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await getBlacklist();
      setBlacklist(list);
      const option = RANGE_OPTIONS.find(o => o.key === range);
      const dateRange = option?.days
        ? { start: Date.now() - option.days * 24 * 60 * 60 * 1000, end: Date.now() }
        : undefined;
      const data = await calculateStatistics(list, dateRange);
      setStats(data);
      const durationData = await getDomainDurations();
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
    if (!stats) return;
    const items = await fetchVisibleHistory({ maxResults: 10000 }, blacklist);
    const csv = exportToCsv(items);
    downloadFile(csv, `browsebuddy-history-${new Date().toISOString().split('T')[0]}.csv`, 'text/csv');
  };

  const handleExportHTML = async () => {
    if (!stats) return;
    const items = await fetchVisibleHistory({ maxResults: 10000 }, blacklist);
    const html = exportToHtml(items, stats, durations);
    downloadFile(html, `browsebuddy-report-${new Date().toISOString().split('T')[0]}.html`, 'text/html');
  };

  if (isLoading) {
    return (
      <div className="loading">
        <div className="spinner" />
        {getMessage('loading')}
      </div>
    );
  }

  if (!stats || stats.totalRecords === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">📊</div>
        <div className="empty-title">{getMessage('noDataAvailable')}</div>
        <div className="empty-desc">
          {blacklist.length > 0 ? getMessage('allFilteredByBlacklist') : getMessage('startBrowsing')}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Time range switcher */}
      <div className="segmented" style={{ marginBottom: '12px', width: '100%', justifyContent: 'space-between' }}>
        {RANGE_OPTIONS.map(opt => (
          <button
            key={opt.key}
            className={`segmented-item ${range === opt.key ? 'active' : ''}`}
            onClick={() => setRange(opt.key)}
            style={{ flex: 1 }}
          >
            {getMessage(`range_${opt.key}`)}
          </button>
        ))}
      </div>

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
      </div>

      {/* Top Sites */}
      <div className="card">
        <h3 className="card-title">{getMessage('topSites')}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {stats.topSites.slice(0, 10).map((site: DomainStats, index: number) => (
            <div key={site.domain} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ 
                width: '24px', 
                height: '24px', 
                borderRadius: '50%', 
                background: index < 3 ? 'var(--primary-color)' : 'var(--bg-tertiary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
                fontWeight: 'bold'
              }}>
                {index + 1}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {site.domain}
                </div>
                <div className="progress-bar" style={{ marginTop: '4px' }}>
                  <div 
                    className="progress-fill" 
                    style={{ width: `${(site.count / Math.max(stats.topSites[0].count, 1)) * 100}%` }}
                  />
                </div>
              </div>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                {formatNumber(site.count)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Top Sites by Dwell Time */}
      {Object.keys(durations).length > 0 && (
        <div className="card">
          <h3 className="card-title">{getMessage('topSitesByTime')}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {Object.entries(durations)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 10)
              .map(([domain, ms], index) => (
                <div key={domain} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    background: index < 3 ? 'var(--secondary-color)' : 'var(--bg-tertiary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '12px',
                    fontWeight: 'bold'
                  }}>
                    {index + 1}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {domain}
                    </div>
                    <div className="progress-bar" style={{ marginTop: '4px' }}>
                      <div
                        className="progress-fill progress-fill-secondary"
                        style={{ width: `${(ms / Math.max(...Object.values(durations), 1)) * 100}%` }}
                      />
                    </div>
                  </div>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    {formatDuration(Math.round(ms / 1000))}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Time Distribution */}
      <div className="card">
        <h3 className="card-title">{getMessage('timeDistribution')}</h3>
        <div style={{ display: 'flex', alignItems: 'flex-end', height: '100px', gap: '2px' }}>
          {stats.timeDistribution.map((hour: TimeDistribution) => {
            const maxCount = Math.max(...stats.timeDistribution.map((h: TimeDistribution) => h.count), 1);
            const height = hour.count > 0 ? (hour.count / maxCount) * 100 : 0;
            return (
              <div
                key={hour.hour}
                style={{
                  flex: 1,
                  height: `${height}%`,
                  background: height > 0 ? 'var(--primary-color)' : 'var(--bg-tertiary)',
                  borderRadius: '2px 2px 0 0',
                  position: 'relative',
                }}
                title={`${hour.hour}:00 - ${hour.count} visits`}
              >
                {hour.hour % 6 === 0 && (
                  <span style={{
                    position: 'absolute',
                    bottom: '-18px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    fontSize: '10px',
                    color: 'var(--text-muted)'
                  }}>
                    {hour.hour}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: '20px', textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)' }}>
          {getMessage('24HourDistribution')}
        </div>
      </div>

      {/* Daily Trend (Last 30 days) */}
      {stats.dailyStats.length > 0 && (
        <div className="card">
          <h3 className="card-title">{getMessage('dailyTrend')}</h3>
          <div style={{ display: 'flex', alignItems: 'flex-end', height: '80px', gap: '2px' }}>
            {stats.dailyStats.slice(-30).map((day: DailyStats) => {
              const maxCount = Math.max(...stats.dailyStats.map((d: DailyStats) => d.count), 1);
              const height = (day.count / maxCount) * 100;
              return (
                <div
                  key={day.date}
                  style={{
                    flex: 1,
                    height: `${height}%`,
                    background: 'var(--secondary-color)',
                    borderRadius: '2px 2px 0 0',
                  }}
                  title={`${day.date}: ${day.count} ${getMessage('visits')}`}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Export Actions */}
      <div className="card">
        <h3 className="card-title">{getMessage('export')}</h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-primary btn-sm" onClick={handleExportCSV}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            {getMessage('exportCSV')}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleExportHTML}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            {getMessage('exportHTML')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default StatsModule;
