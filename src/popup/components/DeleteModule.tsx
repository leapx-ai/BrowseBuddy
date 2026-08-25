import React, { useState } from 'react';
import { getMessage, formatDateTime } from '../../utils/i18n';
import { deleteHistory, previewDelete, type DeleteOptions, type HistoryItem } from '../../utils/history';
import { extractMainDomain } from '../../utils/blacklist';
import ConfirmDialog from './ConfirmDialog';

type DeleteType = 'date' | 'domain' | 'keyword';

// How many preview rows to render before collapsing into a count.
const PREVIEW_LIMIT = 20;

// `<input type="date">` expects a local calendar date. toISOString() would shift
// it by the UTC offset and pick the wrong day for most timezones.
function toDateInputValue(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

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
      setPreviewItems(items);
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
        message: getMessage('deleteSuccess', deletedCount.toString()),
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
          // Normalize to the main domain so "a.example.com", "https://x.example.com"
          // and "example.com" all target the same registrable domain.
          options.domain = extractMainDomain(domain);
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

  // Prefills the date range only - deletion still goes through preview + confirm.
  // `singleDay` targets just that one day instead of the range up to today.
  const prefillLastDays = (days: number, singleDay = false) => {
    const today = new Date();
    const from = new Date(today);
    from.setDate(from.getDate() - days);
    setStartDate(toDateInputValue(from));
    setEndDate(toDateInputValue(singleDay ? from : today));
    setDeleteType('date');
    clearResult();
  };

  return (
    <div>
      {/* Delete Type Tabs */}
      <div className="segmented">
        <button
          className={`segmented-item ${deleteType === 'date' ? 'active' : ''}`}
          onClick={() => { setDeleteType('date'); clearResult(); }}
        >
          {getMessage('deleteByDate')}
        </button>
        <button
          className={`segmented-item ${deleteType === 'domain' ? 'active' : ''}`}
          onClick={() => { setDeleteType('domain'); clearResult(); }}
        >
          {getMessage('deleteByDomain')}
        </button>
        <button
          className={`segmented-item ${deleteType === 'keyword' ? 'active' : ''}`}
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
            aria-label={getMessage('close')}
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

      {/* Quick Actions - these only prefill the date range, they never delete. */}
      <div className="card">
        <h3 className="card-title">{getMessage('quickActions')}</h3>
        <p className="card-hint">{getMessage('quickActionsHint')}</p>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => prefillLastDays(1, true)}>
            {getMessage('deleteYesterday')}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => prefillLastDays(7)}>
            {getMessage('deleteLast7Days')}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => prefillLastDays(30)}>
            {getMessage('deleteLast30Days')}
          </button>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirm && (
        <ConfirmDialog
          title={getMessage('confirmDelete')}
          confirmLabel={getMessage('delete')}
          isBusy={isLoading}
          onCancel={() => setShowConfirm(false)}
          onConfirm={handleDelete}
        >
          <div className="modal-content">
            {getMessage('recordsWillBeDeleted', previewItems.length.toString())}
          </div>
          {/* Show what is actually about to go - a count alone is not a preview. */}
          {previewItems.length > 0 && (
            <div className="preview-list">
              {previewItems.slice(0, PREVIEW_LIMIT).map((item) => (
                <div key={item.id} className="preview-item">
                  <div className="history-title">{item.title || item.url}</div>
                  <div className="history-url">{item.url}</div>
                  {item.lastVisitTime && (
                    <div className="history-time">{formatDateTime(item.lastVisitTime)}</div>
                  )}
                </div>
              ))}
              {previewItems.length > PREVIEW_LIMIT && (
                <div className="preview-more">
                  {getMessage('andMoreRecords', (previewItems.length - PREVIEW_LIMIT).toString())}
                </div>
              )}
            </div>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
};

export default DeleteModule;
