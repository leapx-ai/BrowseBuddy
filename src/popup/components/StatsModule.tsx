import React, { useState, useEffect } from 'react';
import { getMessage, formatNumber } from '../../utils/i18n';
import { calculateStatistics, exportToCsv, exportToHtml, downloadFile, type Statistics } from '../../utils/history';
import type { DomainStats, TimeDistribution, DailyStats } from '../../types';

const StatsModule: React.FC = () => {
  const [stats, setStats] = useState<Statistics | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    setIsLoading(true);
    try {
      const data = await calculateStatistics();
      setStats(data);
    } catch (error) {
      console.error('Failed to load stats:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportCSV = async () => {
    if (!stats) return;
    const { fetchHistory } = await import('../../utils/history');
    const items = await fetchHistory({ maxResults: 10000 });
    const csv = exportToCsv(items);
    downloadFile(csv, `browsebuddy-history-${new Date().toISOString().split('T')[0]}.csv`, 'text/csv');
  };

  const handleExportHTML = async () => {
    if (!stats) return;
    const { fetchHistory } = await import('../../utils/history');
    const items = await fetchHistory({ maxResults: 10000 });
    const html = exportToHtml(items, stats);
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
        <div className="empty-desc">{getMessage('startBrowsing')}</div>
      </div>
    );
  }

  return (
    <div>
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
                    style={{ width: `${(site.count / stats.topSites[0].count) * 100}%` }}
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
