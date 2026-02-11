import React, { useState, useEffect } from 'react';
import { getMessage, formatDateTime } from '../../utils/i18n';
import { fetchHistory, groupByDate, groupByDomain, type HistoryItem } from '../../utils/history';

type ViewMode = 'list' | 'date' | 'domain';

const ViewModule: React.FC = () => {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    setIsLoading(true);
    try {
      const items = await fetchHistory({ maxResults: 500 });
      setHistory(items);
    } catch (error) {
      console.error('Failed to load history:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredHistory = history.filter(item =>
    item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.url.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="loading">
          <div className="spinner" />
          {getMessage('loading')}
        </div>
      );
    }

    if (filteredHistory.length === 0) {
      return (
        <div className="empty-state">
          <div className="empty-icon">📭</div>
          <div className="empty-title">{getMessage('noHistoryFound')}</div>
          <div className="empty-desc">{getMessage('tryAdjustingSearch')}</div>
        </div>
      );
    }

    switch (viewMode) {
      case 'date':
        return <DateGroupView items={filteredHistory} />;
      case 'domain':
        return <DomainGroupView items={filteredHistory} />;
      default:
        return <ListView items={filteredHistory} />;
    }
  };

  return (
    <div>
      {/* Search */}
      <div className="input-group" style={{ marginBottom: '12px' }}>
        <input
          type="text"
          className="input"
          placeholder={getMessage('searchPlaceholder')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* View Mode Tabs */}
      <div className="delete-tabs">
        <button
          className={`delete-tab ${viewMode === 'list' ? 'active' : ''}`}
          onClick={() => setViewMode('list')}
        >
          {getMessage('listView')}
        </button>
        <button
          className={`delete-tab ${viewMode === 'date' ? 'active' : ''}`}
          onClick={() => setViewMode('date')}
        >
          {getMessage('groupByDate')}
        </button>
        <button
          className={`delete-tab ${viewMode === 'domain' ? 'active' : ''}`}
          onClick={() => setViewMode('domain')}
        >
          {getMessage('groupByDomain')}
        </button>
      </div>

      {/* Content */}
      {renderContent()}
    </div>
  );
};

// List View Component
const ListView: React.FC<{ items: HistoryItem[] }> = ({ items }) => {
  return (
    <div className="history-list">
      {items.map((item, index) => (
        <HistoryListItem key={`${item.url}-${index}`} item={item} />
      ))}
    </div>
  );
};

// Date Group View
const DateGroupView: React.FC<{ items: HistoryItem[] }> = ({ items }) => {
  const grouped = groupByDate(items);
  const sortedDates = Array.from(grouped.keys()).sort((a: string, b: string) => b.localeCompare(a));

  return (
    <div>
      {sortedDates.map((date) => (
        <div key={date} className="card" style={{ marginBottom: '12px' }}>
          <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{date}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
              {grouped.get(date)?.length} {getMessage('items')}
            </span>
          </div>
          <div className="history-list">
            {grouped.get(date)?.slice(0, 5).map((item: HistoryItem, index: number) => (
              <HistoryListItem key={`${item.url}-${index}`} item={item} showDate={false} />
            ))}
            {(grouped.get(date)?.length || 0) > 5 && (
              <div style={{ textAlign: 'center', padding: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>
                +{(grouped.get(date)?.length || 0) - 5} {getMessage('more')}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

// Domain Group View
const DomainGroupView: React.FC<{ items: HistoryItem[] }> = ({ items }) => {
  const grouped = groupByDomain(items);
  const sortedDomains = Array.from(grouped.entries())
    .sort((a: [string, HistoryItem[]], b: [string, HistoryItem[]]) => b[1].length - a[1].length);

  return (
    <div>
      {sortedDomains.map(([domain, domainItems]: [string, HistoryItem[]]) => (
        <div key={domain} className="card" style={{ marginBottom: '12px' }}>
          <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <img
                src={`https://www.google.com/s2/favicons?domain=${domain}&sz=16`}
                alt=""
                className="history-favicon"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              {domain}
            </span>
            <span style={{ 
              background: 'var(--primary-color)', 
              color: 'white', 
              padding: '2px 8px', 
              borderRadius: '12px',
              fontSize: '12px'
            }}>
              {domainItems.length}
            </span>
          </div>
          <div className="history-list">
            {domainItems.slice(0, 3).map((item: HistoryItem, index: number) => (
              <HistoryListItem key={`${item.url}-${index}`} item={item} />
            ))}
            {domainItems.length > 3 && (
              <div style={{ textAlign: 'center', padding: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>
                +{domainItems.length - 3} {getMessage('more')}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

// Single History Item
const HistoryListItem: React.FC<{ item: HistoryItem; showDate?: boolean }> = ({ item, showDate = true }) => {
  const [faviconError, setFaviconError] = useState(false);

  const handleClick = () => {
    chrome.tabs.create({ url: item.url });
  };

  return (
    <div className="history-item" onClick={handleClick}>
      {!faviconError ? (
        <img
          src={`https://www.google.com/s2/favicons?domain=${new URL(item.url).hostname}&sz=16`}
          alt=""
          className="history-favicon"
          onError={() => setFaviconError(true)}
        />
      ) : (
        <div className="history-favicon" style={{ background: 'var(--bg-tertiary)', borderRadius: '4px' }} />
      )}
      <div className="history-content">
        <div className="history-title">{item.title || '(No title)'}</div>
        <div className="history-url">{item.url}</div>
      </div>
      {showDate && (
        <div className="history-time">
          {formatDateTime(item.visitTime)}
        </div>
      )}
    </div>
  );
};

export default ViewModule;
