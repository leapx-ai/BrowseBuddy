import React, { useState } from 'react';
import { getMessage } from '../../utils/i18n';
import { deleteHistory, previewDelete, type DeleteOptions, type HistoryItem } from '../../utils/history';
import { getBlacklist } from '../../utils/storage';
import { filterBlacklistedItems } from '../../utils/blacklist';

type DeleteType = 'date' | 'domain' | 'keyword';

const DeleteModule: React.FC = () => {
  const [deleteType, setDeleteType] = useState<DeleteType>('date');
  const [isLoading, setIsLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [previewItems, setPreviewItems] = useState<HistoryItem[]>([]);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  // Form states
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [domain, setDomain] = useState('');
  const [keyword, setKeyword] = useState('');

  const handlePreview = async () => {
    setIsLoading(true);
    try {
      const options = buildDeleteOptions();
      const items = await previewDelete(options);
      const blacklist = await getBlacklist();
      setPreviewItems(filterBlacklistedItems(items, blacklist));
      setShowConfirm(true);
    } catch (error) {
      setResult({
        success: false,
        message: (error as Error).message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    setIsLoading(true);
    try {
      const options = buildDeleteOptions();
      const deletedCount = await deleteHistory(options);
      setResult({
        success: true,
        message: `Successfully deleted ${deletedCount} records`,
      });
      setShowConfirm(false);
      setPreviewItems([]);
    } catch (error) {
      setResult({
        success: false,
        message: (error as Error).message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const buildDeleteOptions = (): DeleteOptions => {
    const options: DeleteOptions = {};

    switch (deleteType) {
      case 'date':
        if (startDate && endDate) {
          options.dateRange = {
            start: new Date(startDate).getTime(),
            end: new Date(endDate).getTime() + 24 * 60 * 60 * 1000 - 1,
          };
        }
        break;
      case 'domain':
        if (domain) {
          options.domain = domain;
        }
        break;
      case 'keyword':
        if (keyword) {
          options.keyword = keyword;
        }
        break;
    }

    return options;
  };

  const clearResult = () => {
    setResult(null);
  };

  return (
    <div>
      {/* Delete Type Tabs */}
      <div className="delete-tabs">
        <button
          className={`delete-tab ${deleteType === 'date' ? 'active' : ''}`}
          onClick={() => { setDeleteType('date'); clearResult(); }}
        >
          {getMessage('deleteByDate')}
        </button>
        <button
          className={`delete-tab ${deleteType === 'domain' ? 'active' : ''}`}
          onClick={() => { setDeleteType('domain'); clearResult(); }}
        >
          {getMessage('deleteByDomain')}
        </button>
        <button
          className={`delete-tab ${deleteType === 'keyword' ? 'active' : ''}`}
          onClick={() => { setDeleteType('keyword'); clearResult(); }}
        >
          {getMessage('deleteByKeyword')}
        </button>
      </div>

      {/* Result Alert */}
      {result && (
        <div className={`alert alert-${result.success ? 'success' : 'warning'}`}>
          {result.message}
          <button 
            className="btn btn-sm btn-secondary" 
            style={{ marginLeft: '10px' }}
            onClick={clearResult}
          >
            ✕
          </button>
        </div>
      )}

      {/* Delete Forms */}
      <div className="card">
        {deleteType === 'date' && (
          <>
            <div className="input-group">
              <label className="input-label">{getMessage('startDate')}</label>
              <input
                type="date"
                className="input"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="input-group">
              <label className="input-label">{getMessage('endDate')}</label>
              <input
                type="date"
                className="input"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </>
        )}

        {deleteType === 'domain' && (
          <div className="input-group">
            <label className="input-label">{getMessage('domain')}</label>
            <input
              type="text"
              className="input"
              placeholder="example.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            />
          </div>
        )}

        {deleteType === 'keyword' && (
          <div className="input-group">
            <label className="input-label">{getMessage('keyword')}</label>
            <input
              type="text"
              className="input"
              placeholder={getMessage('searchPlaceholder')}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
        )}

        <button
          className="btn btn-danger btn-block"
          onClick={handlePreview}
          disabled={isLoading || 
            (deleteType === 'date' && (!startDate || !endDate)) ||
            (deleteType === 'domain' && !domain) ||
            (deleteType === 'keyword' && !keyword)
          }
        >
          {isLoading ? (
            <>
              <div className="spinner" style={{ width: 16, height: 16, marginRight: 8 }} />
              {getMessage('preview')}
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              {getMessage('preview')}
            </>
          )}
        </button>
      </div>

      {/* Quick Actions */}
      <div className="card">
        <h3 className="card-title">{getMessage('quickActions')}</h3>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              const today = new Date();
              const yesterday = new Date(today);
              yesterday.setDate(yesterday.getDate() - 1);
              setStartDate(yesterday.toISOString().split('T')[0]);
              setEndDate(yesterday.toISOString().split('T')[0]);
              setDeleteType('date');
            }}
          >
            {getMessage('deleteYesterday')}
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              const today = new Date();
              const lastWeek = new Date(today);
              lastWeek.setDate(lastWeek.getDate() - 7);
              setStartDate(lastWeek.toISOString().split('T')[0]);
              setEndDate(today.toISOString().split('T')[0]);
              setDeleteType('date');
            }}
          >
            {getMessage('deleteLast7Days')}
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              const today = new Date();
              const lastMonth = new Date(today);
              lastMonth.setMonth(lastMonth.getMonth() - 1);
              setStartDate(lastMonth.toISOString().split('T')[0]);
              setEndDate(today.toISOString().split('T')[0]);
              setDeleteType('date');
            }}
          >
            {getMessage('deleteLast30Days')}
          </button>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="modal-overlay" onClick={() => setShowConfirm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">{getMessage('confirmDelete')}</h3>
            <div className="modal-content">
              {getMessage('recordsWillBeDeleted', previewItems.length.toString())}
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setShowConfirm(false)}
              >
                {getMessage('cancel')}
              </button>
              <button
                className="btn btn-danger"
                onClick={handleDelete}
                disabled={isLoading}
              >
                {isLoading ? (
                  <div className="spinner" style={{ width: 16, height: 16 }} />
                ) : (
                  getMessage('delete')
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DeleteModule;
