import React, { useState } from 'react';
import { getMessage, formatDateTime } from '../../utils/i18n';
import { deleteHistory, previewDelete, toLocalDateKey, type DeleteOptions, type HistoryItem } from '../../utils/history';
import { extractMainDomain } from '../../utils/blacklist';
import ConfirmDialog from './ConfirmDialog';
import { Icon } from './Icon';
import SubTabs from './SubTabs';

type DeleteType = 'date' | 'domain' | 'keyword';

// How many preview rows to render before collapsing into a count.
const PREVIEW_LIMIT = 20;

// `<input type="date">` expects a local calendar date, which is exactly what
// toLocalDateKey produces. This was a third private copy of that formatting
// (history.ts had one, the calendar view built a fourth inline); toISOString()
// would shift the value by the UTC offset and pick the wrong day.
function toDateInputValue(date: Date): string {
  return toLocalDateKey(date.getTime());
}

// Mirror of the above on the way out. `new Date("2026-08-25")` is parsed as UTC
// midnight per spec, so in UTC+8 a range built that way starts at 08:00 local
// and spills into the next day - deleting a day the user never selected while
// leaving part of the selected one behind.
function startOfLocalDay(value: string): number {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day).getTime();
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
      // Delete exactly what the preview showed, not a fresh query.
      const deletedCount = await deleteHistory(previewItems, options.dateRange);
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

  // Derived, not state - the Preview guard has to test the value that actually
  // reaches the delete query. `extractMainDomain` returns '' for unparseable
  // input, and an empty domain means "no domain filter", i.e. the whole history.
  const normalizedDomain = domain.trim() ? extractMainDomain(domain) : '';

  // yyyy-mm-dd strings sort chronologically, so a plain comparison is enough.
  // An inverted range built an empty window and Preview reported "0 records",
  // which reads as "nothing matched" rather than "the dates are backwards".
  const today = toDateInputValue(new Date());
  const isRangeInverted = !!startDate && !!endDate && startDate > endDate;

  const buildDeleteOptions = (): DeleteOptions => {
    const options: DeleteOptions = {};

    switch (deleteType) {
      case 'date':
        if (startDate && endDate) {
          options.dateRange = {
            start: startOfLocalDay(startDate),
            end: startOfLocalDay(endDate) + 24 * 60 * 60 * 1000 - 1,
          };
        }
        break;
      case 'domain':
        if (normalizedDomain) {
          // Normalized to the main domain so "a.example.com",
          // "https://x.example.com" and "example.com" all target the same
          // registrable domain.
          options.domain = normalizedDomain;
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
      <SubTabs
        label={getMessage('navDelete')}
        activeId={deleteType}
        onChange={(type) => { setDeleteType(type); clearResult(); }}
        items={[
          { id: 'date', label: getMessage('deleteByDate') },
          { id: 'domain', label: getMessage('deleteByDomain') },
          { id: 'keyword', label: getMessage('deleteByKeyword') },
        ]}
      />

      {/* Result Alert */}
      {result && (
        <div className={`alert alert-${result.success ? 'success' : 'warning'}`}>
          {result.message}
          <button
            className="btn btn-sm btn-secondary alert-dismiss btn-icon-only"
            onClick={clearResult}
            aria-label={getMessage('close')}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      {/* Delete Forms */}
      <div className="card">
        {deleteType === 'date' && (
          <>
            <div className="input-group">
              <label className="input-label">{getMessage('startDate')}</label>
              {/* max stops at today: history cannot contain future visits, so a
                  future date can only produce an empty result. */}
              <input
                type="date"
                className="input"
                max={endDate || today}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="input-group">
              <label className="input-label">{getMessage('endDate')}</label>
              <input
                type="date"
                className="input"
                min={startDate || undefined}
                max={today}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
              {isRangeInverted && (
                <p className="field-hint is-error">{getMessage('invalidDateRange')}</p>
              )}
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
            {/* Echo what will actually be targeted - the raw input is normalized
                to a registrable domain, and unparseable input yields nothing. */}
            {normalizedDomain && (
              <p className="card-hint form-note">
                {getMessage('deleteTargetDomain', normalizedDomain)}
              </p>
            )}
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
            (deleteType === 'date' && (!startDate || !endDate || isRangeInverted)) ||
            (deleteType === 'domain' && !normalizedDomain) ||
            (deleteType === 'keyword' && !keyword)
          }
        >
          {isLoading ? (
            <>
              <div className="spinner is-sm" />
              {getMessage('preview')}
            </>
          ) : (
            <>
              <Icon name="eye" size={16} />
              {getMessage('preview')}
            </>
          )}
        </button>
      </div>

      {/* Quick Actions - these only prefill the date range, they never delete. */}
      <div className="card">
        <h3 className="card-title">{getMessage('quickActions')}</h3>
        <p className="card-hint">{getMessage('quickActionsHint')}</p>
        <div className="btn-row is-wrap">
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
                  {item.visitTime > 0 && (
                    <div className="history-time">{formatDateTime(item.visitTime)}</div>
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
