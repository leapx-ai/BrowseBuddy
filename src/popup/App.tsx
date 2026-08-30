import React, { useState, useEffect, useCallback } from 'react';
import { getMessage, initI18n, applyTheme, setUserLanguage } from '../utils/i18n';
import { getSettings } from '../utils/storage';
import Navigation from './components/Navigation';
import DeleteModule from './components/DeleteModule';
import ViewModule from './components/ViewModule';
import StatsModule from './components/StatsModule';
import PrivacyModule from './components/PrivacyModule';
import { useSlowLoading } from './useSlowLoading';

export type TabType = 'delete' | 'view' | 'stats' | 'privacy';

const App: React.FC = () => {
  // Browsing history is the high-frequency task; blacklist setup is a one-off.
  const [activeTab, setActiveTab] = useState<TabType>('view');
  const [isLoading, setIsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const showSlowLoading = useSlowLoading(isLoading);

  const loadSettings = useCallback(async () => {
    try {
      // Initialize i18n and theme
      await initI18n();
      const settings = await getSettings();
      applyTheme(settings.theme);
      setUserLanguage(settings.language);
    } catch (error) {
      console.error('Failed to load settings:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();

    // storage.onChanged is the only channel between the options page, the
    // service worker and this popup - there is no message passing - so language
    // and theme changes arrive here.
    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (!changes.browsebuddy_settings) return;
      const newSettings = changes.browsebuddy_settings.newValue;
      if (!newSettings) return;

      const previous = changes.browsebuddy_settings.oldValue;
      setUserLanguage(newSettings.language);
      applyTheme(newSettings.theme);

      // Remount only for a language change. getMessage() reads a module-level
      // language and is not reactive, so the tree genuinely has to be rebuilt
      // for new labels to appear - but a remount also destroys an open delete
      // confirmation mid-flight, snaps a list scrolled to 600 rows back to 60,
      // and clears text the user has typed but not submitted. Bumping on *any*
      // settings write meant flipping a switch on the options page, or the
      // worker syncing the incognito badge, did all of that for no reason. The
      // theme needs no remount at all: applyTheme sets a data attribute.
      if (previous && newSettings.language === previous.language) return;
      setRefreshKey(prev => prev + 1);
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [loadSettings]);

  // No per-module keys: the container below already carries `refreshKey`, so a
  // bump remounts the whole subtree. Spelling it out on each module as well was
  // redundant and invited the reading that modules could be remounted
  // independently.
  const renderContent = () => {
    switch (activeTab) {
      case 'delete':
        return <DeleteModule />;
      case 'view':
        return <ViewModule />;
      case 'stats':
        return <StatsModule />;
      case 'privacy':
        return <PrivacyModule />;
      default:
        return <ViewModule />;
    }
  };

  if (isLoading) {
    // i18n has to resolve before any label can render, but keep the panel at
    // full size and blank instead of flashing a spinner for a few milliseconds.
    return (
      <div className="popup-container">
        {showSlowLoading && (
          <div className="loading">
            <div className="spinner" />
            {getMessage('loading')}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="popup-container" key={refreshKey}>
      {/*
        Brand bar at the top, blended into the page: no frame around it, just
        the mark and the name. The settings control stays a quiet secondary
        button. The privacy promise below is the real footer.
      */}
      <header className="brand-bar">
        <div className="brand-bar-title">
          <img
            className="brand-bar-icon"
            src={chrome.runtime.getURL('icons/icon64.png')}
            alt="BrowseBuddy"
          />
          BrowseBuddy
        </div>
        <button
          className="btn btn-sm btn-secondary"
          onClick={() => chrome.runtime.openOptionsPage?.()}
          aria-label={getMessage('settings')}
          title={getMessage('settings')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 1v6m0 6v10m11-7h-6m-6 0H1m20.07-4.93l-4.24 4.24M7.17 16.83l-4.24 4.24m18.34 0l-4.24-4.24M7.17 7.17L2.93 2.93" />
          </svg>
        </button>
      </header>

      <main
        className="main-content"
        role="tabpanel"
        id={`panel-${activeTab}`}
        aria-labelledby={`tab-${activeTab}`}
      >
        {renderContent()}
      </main>

      {/*
        The privacy promise is a claim about how the extension handles data, so it
        belongs on the page that manages that. Pinned to every tab it consumed
        ~36px of a 600px window permanently - space the history list needs more.
      */}
      {activeTab === 'privacy' && (
        <footer className="footer">
          {getMessage('privacyPromise')}
        </footer>
      )}

      {/*
        The four tabs sit at the bottom, thumb-reach for the mouse and the
        common pattern for a tool whose content is the top of the stack.
      */}
      <Navigation activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
};

export default App;
