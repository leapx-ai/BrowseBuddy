import React, { useState, useEffect } from 'react';
import { getMessage } from '../../utils/i18n';
import { 
  getBlacklist, 
  removeFromBlacklist, 
  updateBlacklistEntry,
  addUrlToBlacklist,
  getFavorites,
  addFavorite,
  removeFavorite,
  extractMainDomain,
  type BlacklistEntry 
} from '../../utils/storage';
import ConfirmDialog from './ConfirmDialog';
import { useSlowLoading } from '../useSlowLoading';

const PrivacyModule: React.FC = () => {
  const [blacklist, setBlacklist] = useState<BlacklistEntry[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Blacklist and favorites are opposite operations, so they must never share
  // an input buffer - otherwise typing a domain to protect also arms the
  // "add to blacklist" button with the same value.
  const [newBlacklistUrl, setNewBlacklistUrl] = useState('');
  const [newFavoriteUrl, setNewFavoriteUrl] = useState('');
  const [currentTab, setCurrentTab] = useState<chrome.tabs.Tab | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  // Destructive by nature, so it defaults to off and is confirmed in the modal.
  const [deleteExisting, setDeleteExisting] = useState(false);
  const [lastAction, setLastAction] = useState<{type: 'add'|'delete', message: string} | null>(null);
  const [pendingAdd, setPendingAdd] = useState<string | null>(null);
  const [pendingDomain, setPendingDomain] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);
  const showSlowLoading = useSlowLoading(isLoading);

  useEffect(() => {
    loadBlacklist();
    loadFavorites();
    getCurrentTab();
  }, []);

  const loadFavorites = async () => {
    try {
      const favs = await getFavorites();
      setFavorites(favs);
    } catch (error) {
      console.error('Failed to load favorites:', error);
    }
  };

  const handleAddFavorite = async () => {
    if (!favoriteDomain) return;
    try {
      await addFavorite(favoriteDomain);
      setNewFavoriteUrl('');
      await loadFavorites();
    } catch (error) {
      console.error('Failed to add favorite:', error);
    }
  };

  const handleAddCurrentAsFavorite = async () => {
    if (!currentTab?.url) return;
    try {
      await addFavorite(currentTab.url);
      await loadFavorites();
    } catch (error) {
      console.error('Failed to add current page to favorites:', error);
    }
  };

  const handleRemoveFavorite = async (domain: string) => {
    try {
      await removeFavorite(domain);
      await loadFavorites();
    } catch (error) {
      console.error('Failed to remove favorite:', error);
    }
  };

  // Derived, not state - each input owns its own normalized domain.
  const blacklistDomain = newBlacklistUrl.trim() ? extractMainDomain(newBlacklistUrl) : '';
  const favoriteDomain = newFavoriteUrl.trim() ? extractMainDomain(newFavoriteUrl) : '';

  const loadBlacklist = async () => {
    try {
      const list = await getBlacklist();
      setBlacklist(list);
    } catch (error) {
      console.error('Failed to load blacklist:', error);
    } finally {
      // Only the first load gates rendering. Later refreshes (toggle, add,
      // remove) update the list in place instead of blanking the whole page.
      setIsLoading(false);
    }
  };

  const getCurrentTab = async () => {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) {
        setCurrentTab(tabs[0]);
      }
    } catch (error) {
      console.error('Failed to get current tab:', error);
    }
  };

  const requestConfirmAdd = (url: string, domain: string) => {
    setPendingAdd(url);
    setPendingDomain(domain);
    // Never carry a previous "delete history too" choice into a new confirmation.
    setDeleteExisting(false);
    setIsConfirming(true);
  };

  const cancelConfirm = () => {
    setPendingAdd(null);
    setIsConfirming(false);
  };

  const executeAdd = async () => {
    if (!pendingAdd) return;
    try {
      const { entry, deletedCount } = await addUrlToBlacklist(pendingAdd, deleteExisting);
      setPendingAdd(null);
      setIsConfirming(false);
      if (entry) {
        let message = getMessage('domainAddedToBlacklist', pendingDomain);
        if (deleteExisting && deletedCount > 0) {
          message += ` (${getMessage('deletedNHistoryRecords', deletedCount.toString())})`;
        }
        setLastAction({ type: 'add', message });
        setNewBlacklistUrl('');
        setShowAddForm(false);
        await loadBlacklist();
        // Clear message after 3 seconds
        setTimeout(() => setLastAction(null), 3000);
      } else {
        // Already exists
        setLastAction({ type: 'add', message: getMessage('domainAlreadyInBlacklist', pendingDomain) });
        setNewBlacklistUrl('');
        setShowAddForm(false);
        setTimeout(() => setLastAction(null), 3000);
      }
    } catch (error) {
      console.error('Failed to add to blacklist:', error);
    }
  };

  const handleAdd = () => {
    if (!blacklistDomain) return;
    requestConfirmAdd(newBlacklistUrl.trim(), blacklistDomain);
  };

  const handleAddCurrentPage = () => {
    if (!currentTab?.url) return;
    requestConfirmAdd(currentTab.url, extractMainDomain(currentTab.url));
  };

  const handleRemove = async (id: string) => {
    try {
      await removeFromBlacklist(id);
      await loadBlacklist();
    } catch (error) {
      console.error('Failed to remove from blacklist:', error);
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await updateBlacklistEntry(id, { enabled: !enabled });
      await loadBlacklist();
    } catch (error) {
      console.error('Failed to toggle blacklist entry:', error);
    }
  };

  const isCurrentPageBlacklisted = currentTab?.url ? 
    blacklist.some(entry => entry.enabled && entry.pattern === extractMainDomain(currentTab.url!)) : 
    false;

  if (isLoading) {
    return showSlowLoading ? (
      <div className="loading">
        <div className="spinner" />
        {getMessage('loading')}
      </div>
    ) : null;
  }

  return (
    <div>
      {/* Info Card */}
      <div className="alert alert-info" style={{ marginBottom: '12px' }}>
        <strong>{getMessage('realtimeProtection')}</strong>
        <p style={{ marginTop: '4px', marginBottom: 0 }}>
          {getMessage('blacklistDescription')}
        </p>
      </div>

      {/* Action Result Message */}
      {lastAction && (
        <div className={`alert ${lastAction.type === 'add' ? 'alert-success' : 'alert-info'}`} style={{ marginBottom: '12px' }}>
          {lastAction.message}
        </div>
      )}

      {/* Current Domain Display */}
      {currentTab?.url && (
        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
          {getMessage('currentDomain')}: {extractMainDomain(currentTab.url)}
        </div>
      )}

      {/* Quick Add Current Page */}
      {currentTab?.url && !currentTab.url.startsWith('chrome://') && !currentTab.url.startsWith('chrome-extension://') && !currentTab.url.startsWith('about:') && !currentTab.url.startsWith('edge://') && (
        <button
          className={`btn btn-block ${isCurrentPageBlacklisted ? 'btn-secondary' : 'btn-primary'}`}
          onClick={handleAddCurrentPage}
          disabled={isCurrentPageBlacklisted}
          style={{ marginBottom: '12px' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '6px' }}>
            {isCurrentPageBlacklisted ? (
              <polyline points="20 6 9 17 4 12" />
            ) : (
              <>
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </>
            )}
          </svg>
          {isCurrentPageBlacklisted 
            ? getMessage('alreadyInBlacklist', extractMainDomain(currentTab.url))
            : getMessage('addCurrentPage', extractMainDomain(currentTab.url))}
        </button>
      )}

      {/* Add Button */}
      <button
        className="btn btn-secondary btn-block"
        onClick={() => setShowAddForm(!showAddForm)}
        style={{ marginBottom: '12px' }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '6px' }}>
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        {getMessage('manualAddDomain')}
      </button>

      {/* Add Form */}
      {showAddForm && (
        <div className="card" style={{ marginBottom: '12px' }}>
          <div className="input-group">
            <label className="input-label">{getMessage('enterUrlOrDomain')}</label>
            <input
              type="text"
              className="input"
              placeholder="https://example.com 或 example.com"
              value={newBlacklistUrl}
              onChange={(e) => setNewBlacklistUrl(e.target.value)}
            />
            {blacklistDomain && (
              <p style={{ marginTop: '4px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                {getMessage('willAddMainDomain')} <strong>{blacklistDomain}</strong>{getMessage('includesAllSubdomains')}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-secondary" onClick={() => setShowAddForm(false)}>
              {getMessage('cancel')}
            </button>
            <button className="btn btn-primary" onClick={handleAdd} disabled={!blacklistDomain}>
              {getMessage('add')}
            </button>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {isConfirming && (
        <ConfirmDialog
          title={getMessage('confirm')}
          confirmLabel={getMessage('confirmButton')}
          onCancel={cancelConfirm}
          onConfirm={executeAdd}
        >
          <div className="modal-content">
            {getMessage(
              deleteExisting ? 'confirmAddBlacklist' : 'confirmAddBlacklistNoDelete',
              pendingDomain
            )}
          </div>
          {/* The destructive option lives next to the button that acts on it. */}
          <label className="checkbox-wrapper modal-option">
            <input
              type="checkbox"
              className="checkbox-input"
              checked={deleteExisting}
              onChange={(e) => setDeleteExisting(e.target.checked)}
            />
            <span className={`checkbox ${deleteExisting ? 'checked' : ''}`} aria-hidden="true">
              {deleteExisting && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </span>
            <span className="checkbox-label">{getMessage('alsoDeleteExistingHistory')}</span>
          </label>
        </ConfirmDialog>
      )}

      {/* Blacklist */}
      <div>
        <h3 className="card-title" style={{ marginBottom: '12px' }}>
          {getMessage('blacklist')} ({blacklist.length})
        </h3>
        
        {blacklist.length === 0 ? (
          <div className="empty-state" style={{ padding: '30px 20px' }}>
            <div className="empty-icon">🛡️</div>
            <div className="empty-title">{getMessage('noBlacklistEntries')}</div>
            <div className="empty-desc">{getMessage('addDomainsToProtectPrivacy')}</div>
          </div>
        ) : (
          <div>
            {blacklist.map((entry) => (
              <div key={entry.id} className="blacklist-item">
                <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
                  <label className="checkbox-wrapper" style={{ flex: 1 }}>
                    <input
                      type="checkbox"
                      className="checkbox-input"
                      checked={entry.enabled}
                      onChange={() => handleToggle(entry.id, entry.enabled)}
                    />
                    <span className={`checkbox ${entry.enabled ? 'checked' : ''}`} aria-hidden="true">
                      {entry.enabled && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </span>
                    <span className="blacklist-pattern" style={{ 
                      opacity: entry.enabled ? 1 : 0.5,
                      textDecoration: entry.enabled ? 'none' : 'line-through'
                    }}>
                      {entry.pattern}
                    </span>
                  </label>
                </div>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => handleRemove(entry.id)}
                  aria-label={getMessage('removeFromBlacklistLabel', entry.pattern)}
                  style={{ padding: '4px 8px' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Favorites (Protected Domains) */}
      <div className="card" style={{ marginTop: '16px' }}>
        <h3 className="card-title">
          {getMessage('favorites')} ({favorites.length})
        </h3>
        {/* Explanatory copy, not a warning - a full alert block over-weights it. */}
        <p className="card-hint">{getMessage('favoritesDescription')}</p>

        {currentTab?.url && !currentTab.url.startsWith('chrome://') && (
          <button
            className="btn btn-secondary btn-block"
            onClick={handleAddCurrentAsFavorite}
            style={{ marginBottom: '12px' }}
          >
            ★ {getMessage('addCurrentToFavorites', extractMainDomain(currentTab.url))}
          </button>
        )}

        <div className="input-group">
          <input
            type="text"
            className="input"
            placeholder={getMessage('enterDomainForFavorites')}
            value={newFavoriteUrl}
            onChange={(e) => setNewFavoriteUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddFavorite(); }}
          />
        </div>
        <button
          className="btn btn-primary btn-block"
          onClick={handleAddFavorite}
          disabled={!favoriteDomain}
          style={{ marginBottom: '12px' }}
        >
          ★ {getMessage('addFavorite')}
        </button>

        {favorites.length === 0 ? (
          <div className="empty-state" style={{ padding: '20px' }}>
            <div className="empty-icon">⭐</div>
            <div className="empty-title">{getMessage('noFavorites')}</div>
          </div>
        ) : (
          <div>
            {favorites.map((domain) => (
              <div key={domain} className="blacklist-item">
                <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
                  <span className="blacklist-pattern" style={{ flex: 1 }}>★ {domain}</span>
                </div>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => handleRemoveFavorite(domain)}
                  aria-label={getMessage('removeFromFavoritesLabel', domain)}
                  style={{ padding: '4px 8px' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pattern Examples - reference material, collapsed so it does not
          push the actual controls off the first screen. */}
      <details className="disclosure">
        <summary className="disclosure-summary">{getMessage('usageInstructions')}</summary>
        <div className="disclosure-body">
          <p style={{ marginBottom: '8px' }}>
            {getMessage('autoExtractDescription')}
          </p>
          <p style={{ marginBottom: '8px' }}>
            <strong>{getMessage('example')}:</strong> <code>https://www.example.com/page</code> → <code>example.com</code>
          </p>
          <p>
            {getMessage('autoMatchDescription')}: <code>example.com</code>、<code>www.example.com</code>、<code>sub.example.com</code>
          </p>
        </div>
      </details>
    </div>
  );
};

export default PrivacyModule;
