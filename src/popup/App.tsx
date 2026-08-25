import React, { useState, useEffect, useCallback } from 'react';
import { getMessage, initI18n, applyTheme, setUserLanguage } from '../utils/i18n';
import { getSettings } from '../utils/storage';
import Navigation from './components/Navigation';
import DeleteModule from './components/DeleteModule';
import ViewModule from './components/ViewModule';
import StatsModule from './components/StatsModule';
import PrivacyModule from './components/PrivacyModule';

export type TabType = 'delete' | 'view' | 'stats' | 'privacy';

const App: React.FC = () => {
  // Browsing history is the high-frequency task; blacklist setup is a one-off.
  const [activeTab, setActiveTab] = useState<TabType>('view');
  const [isLoading, setIsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

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
    
    // Listen for storage changes to update language and theme
    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.browsebuddy_settings) {
        const newSettings = changes.browsebuddy_settings.newValue;
        if (newSettings) {
          setUserLanguage(newSettings.language);
          applyTheme(newSettings.theme);
          // Force re-render to update language
          setRefreshKey(prev => prev + 1);
        }
      }
    };
    
    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [loadSettings]);

  const renderContent = () => {
    switch (activeTab) {
      case 'delete':
        return <DeleteModule key={`delete-${refreshKey}`} />;
      case 'view':
        return <ViewModule key={`view-${refreshKey}`} />;
      case 'stats':
        return <StatsModule key={`stats-${refreshKey}`} />;
      case 'privacy':
        return <PrivacyModule key={`privacy-${refreshKey}`} />;
      default:
        return <ViewModule key={`view-${refreshKey}`} />;
    }
  };

  if (isLoading) {
    return (
      <div className="popup-container">
        <div className="loading">
          <div className="spinner" />
          {getMessage('loading')}
        </div>
      </div>
    );
  }

  return (
    <div className="popup-container" key={refreshKey}>
      <header className="header">
        <div className="header-title">
          <img 
            className="header-icon" 
            src={chrome.runtime.getURL('icons/icon64.png')} 
            alt="BrowseBuddy"
            style={{ width: '24px', height: '24px', borderRadius: '4px' }}
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

      <Navigation activeTab={activeTab} onTabChange={setActiveTab} />

      <main className="main-content">
        {renderContent()}
      </main>

      <footer className="footer">
        {getMessage('privacyPromise')}
      </footer>
    </div>
  );
};

export default App;
