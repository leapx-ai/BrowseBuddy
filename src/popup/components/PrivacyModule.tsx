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
import { isInternalUrl, isUrlBlacklisted } from '../../utils/blacklist';
import ConfirmDialog from './ConfirmDialog';
import { Icon } from './Icon';
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
  // The add can take tens of seconds when "also delete history" is checked, and
  // the dialog stayed live the whole time - a second click started a second
  // blacklist insert and a second deletion sweep over the same domain.
  const [isAdding, setIsAdding] = useState(false);
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
    // Closing mid-flight would leave the sweep running with no indication.
    if (isAdding) return;
    setPendingAdd(null);
    setIsConfirming(false);
  };

  const executeAdd = async () => {
    if (!pendingAdd || isAdding) return;
    setIsAdding(true);
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
    } finally {
      setIsAdding(false);
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

  const isCurrentPageBlacklisted = currentTab?.url
    // Was reimplemented inline here as `entry.enabled && entry.pattern ===
    // extractMainDomain(url)`, a second copy of the matching rule that would
    // drift from the canonical one the moment either changed.
    ? isUrlBlacklisted(currentTab.url, blacklist)
    : false;

  const isAddressable = !!currentTab?.url && !isInternalUrl(currentTab.url);

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
      <div className="alert alert-info">
        <strong>{getMessage('realtimeProtection')}</strong>
        <p className="form-note">
          {getMessage('blacklistDescription')}
        </p>
      </div>

      {/* Action Result Message */}
      {lastAction && (
        <div className={`alert ${lastAction.type === 'add' ? 'alert-success' : 'alert-info'}`}>
          {lastAction.message}
        </div>
      )}

      {/* Current Domain Display */}
      {currentTab?.url && (
        <div className="meta-line">
          {getMessage('currentDomain')}: {extractMainDomain(currentTab.url)}
        </div>
      )}

      {/* Quick Add Current Page */}
      {isAddressable && (
        <button
          className={`btn btn-block gap-below-lg ${isCurrentPageBlacklisted ? 'btn-secondary' : 'btn-primary'}`}
          onClick={handleAddCurrentPage}
          disabled={isCurrentPageBlacklisted}
        >
          <Icon name={isCurrentPageBlacklisted ? 'check' : 'plus'} size={16} />
          {isCurrentPageBlacklisted 
            ? getMessage('alreadyInBlacklist', extractMainDomain(currentTab!.url!))
            : getMessage('addCurrentPage', extractMainDomain(currentTab!.url!))}
        </button>
      )}

      {/* Add Button */}
      <button
        className="btn btn-secondary btn-block gap-below-lg"
        onClick={() => setShowAddForm(!showAddForm)}
      >
        <Icon name="plus" size={16} />
        {getMessage('manualAddDomain')}
      </button>

      {/* Add Form */}
      {showAddForm && (
        <div className="card">
          <div className="input-group">
            <label className="input-label">{getMessage('enterUrlOrDomain')}</label>
            <input
              type="text"
              className="input"
              placeholder={getMessage('urlOrDomainExample')}
              value={newBlacklistUrl}
              onChange={(e) => setNewBlacklistUrl(e.target.value)}
            />
            {blacklistDomain && (
              <p className="field-note">
                {getMessage('willAddMainDomain')} <strong>{blacklistDomain}</strong>{getMessage('includesAllSubdomains')}
              </p>
            )}
          </div>
          <div className="btn-row">
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
          isBusy={isAdding}
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

      {/* Blacklist. Blacklist and favourites are two lists of the same kind, so
          they get the same container - the blacklist used to be a bare div and
          the favourites a card, which read as two unrelated levels. */}
      <div className="card">
        <h3 className="card-title">
          {getMessage('blacklist')} ({blacklist.length})
        </h3>
        
        {blacklist.length === 0 ? (
          <div className="empty-state is-roomy">
            <div className="empty-icon"><Icon name="shield" size={40} /></div>
            <div className="empty-title">{getMessage('noBlacklistEntries')}</div>
            <div className="empty-desc">{getMessage('addDomainsToProtectPrivacy')}</div>
          </div>
        ) : (
          <div>
            {blacklist.map((entry) => (
              <div key={entry.id} className="blacklist-item">
                <div className="entry-main">
                  <label className="checkbox-wrapper is-fill">
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
                    <span className={`blacklist-pattern ${entry.enabled ? '' : 'is-muted-text'}`}>
                      {entry.pattern}
                    </span>
                  </label>
                </div>
                <button
                  className="btn btn-sm btn-danger btn-icon-only"
                  onClick={() => handleRemove(entry.id)}
                  aria-label={getMessage('removeFromBlacklistLabel', entry.pattern)}
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Favorites (Protected Domains) */}
      <div className="card">
        <h3 className="card-title">
          {getMessage('favorites')} ({favorites.length})
        </h3>
        {/* Explanatory copy, not a warning - a full alert block over-weights it. */}
        <p className="card-hint">{getMessage('favoritesDescription')}</p>

        {isAddressable && (
          <button
            className="btn btn-secondary btn-block gap-below-lg"
            onClick={handleAddCurrentAsFavorite}
          >
            <Icon name="star" size={16} />
            {getMessage('addCurrentToFavorites', extractMainDomain(currentTab!.url!))}
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
          className="btn btn-primary btn-block gap-below-lg"
          onClick={handleAddFavorite}
          disabled={!favoriteDomain}
        >
          <Icon name="star" size={16} />
          {getMessage('addFavorite')}
        </button>

        {favorites.length === 0 ? (
          <div className="empty-state is-compact">
            <div className="empty-icon"><Icon name="star" size={40} /></div>
            <div className="empty-title">{getMessage('noFavorites')}</div>
          </div>
        ) : (
          <div>
            {favorites.map((domain) => (
              <div key={domain} className="blacklist-item">
                <div className="entry-main">
                  <span className="blacklist-pattern is-fill">
                    <Icon name="star-filled" size={13} /> {domain}
                  </span>
                </div>
                <button
                  className="btn btn-sm btn-danger btn-icon-only"
                  onClick={() => handleRemoveFavorite(domain)}
                  aria-label={getMessage('removeFromFavoritesLabel', domain)}
                >
                  <Icon name="close" size={14} />
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
          <p>
            {getMessage('autoExtractDescription')}
          </p>
          <p>
            <strong>{getMessage('example')}:</strong> <code>https://www.example.com/page</code> → <code>example.com</code>
          </p>
          <p>
            {/* Comma, not the CJK "、" that used to be hard-coded here - these are
                latin code samples and the page also renders in English. */}
            {getMessage('autoMatchDescription')}: <code>example.com</code>, <code>www.example.com</code>, <code>sub.example.com</code>
          </p>
        </div>
      </details>
    </div>
  );
};

export default PrivacyModule;
