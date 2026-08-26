import React, { useState, useEffect, useCallback } from 'react';
import { getMessage, setUserLanguage, applyTheme, initI18n } from '../utils/i18n';
import { getSettings, saveSettings, getStorageUsage, createBackup, restoreBackup, type Settings } from '../utils/storage';

type ToastType = 'success' | 'error';

/*
 * A labelled on/off row.
 *
 * The switch was a <div onClick>, four times over: not focusable, not operable
 * from the keyboard, and announced as nothing. It is a <button role="switch">
 * now, so Tab reaches it, Space/Enter toggle it and aria-checked carries the
 * state. Written once instead of four times so the attributes cannot drift
 * between copies.
 */
const ToggleRow: React.FC<{
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}> = ({ label, description, checked, onChange }) => (
  <div className="toggle-wrapper">
    <div className="toggle-info">
      <div className="toggle-label">{label}</div>
      <div className="toggle-description">{description}</div>
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle-switch ${checked ? 'active' : ''}`}
      onClick={onChange}
    >
      <span className="toggle-knob" />
    </button>
  </div>
);

const App: React.FC = () => {
  const [isWelcome, setIsWelcome] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [storageInfo, setStorageInfo] = useState<{ used: number; total: number } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0); // Used to force re-render for i18n
  const [toast, setToast] = useState<{ type: ToastType; message: string } | null>(null);

  useEffect(() => {
    // Check if this is the welcome page
    const urlParams = new URLSearchParams(window.location.search);
    setIsWelcome(urlParams.get('welcome') === 'true');
    
    initAndLoadSettings();
    loadStorageInfo();
  }, []);

  // Auto-dismiss toasts
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const showToast = useCallback((type: ToastType, message: string) => {
    setToast({ type, message });
  }, []);

  const initAndLoadSettings = async () => {
    setIsLoading(true);
    try {
      // Initialize i18n first
      await initI18n();
      
      const stored = await getSettings();
      setSettings(stored);
      
      // Apply initial theme
      applyTheme(stored.theme);
    } catch (error) {
      console.error('Failed to load settings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadStorageInfo = async () => {
    try {
      const info = await getStorageUsage();
      setStorageInfo(info);
    } catch (error) {
      console.error('Failed to load storage info:', error);
    }
  };

  const updateSettings = useCallback(async (updates: Partial<Settings>) => {
    if (!settings) return;
    
    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);
    
    try {
      await saveSettings(newSettings);
      
      // Apply theme change immediately
      if (updates.theme) {
        applyTheme(updates.theme);
      }
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  }, [settings]);

  // Language changes are applied in a dedicated handler that re-inits i18n
  // and re-renders, instead of relying on storage change propagation.
  const handleLanguageChange = useCallback(async (lang: 'en' | 'zh_CN') => {
    if (!settings) return;
    const newSettings = { ...settings, language: lang };
    setSettings(newSettings);
    try {
      await saveSettings(newSettings);
      setUserLanguage(lang);
      setRefreshKey(prev => prev + 1);
    } catch (error) {
      console.error('Failed to save language:', error);
    }
  }, [settings]);

  const handleBackup = async () => {
    try {
      const backup = await createBackup();
      const blob = new Blob([backup], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `browsebuddy-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('success', getMessage('backupSuccess'));
    } catch (error) {
      showToast('error', getMessage('backupFailed', (error as Error).message));
    }
  };

  const handleRestore = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      
      try {
        const text = await file.text();
        await restoreBackup(text);
        showToast('success', getMessage('restoreSuccess'));
        setTimeout(() => window.location.reload(), 800);
      } catch (error) {
        showToast('error', getMessage('restoreFailed', (error as Error).message));
      }
    };
    input.click();
  };

  if (isLoading) {
    return (
      <div className="options-container">
        <div className="page-status">{getMessage('loading')}</div>
      </div>
    );
  }

  if (isWelcome) {
    const handleGetStarted = () => {
      setIsWelcome(false);
      // Remove the ?welcome=true query param so refreshing the page
      // doesn't re-enter the welcome flow.
      const url = new URL(window.location.href);
      url.searchParams.delete('welcome');
      window.history.replaceState({}, '', url.toString());
    };
    return (
      <div className="options-container">
        <WelcomePage
          onGetStarted={handleGetStarted}
          language={settings?.language || 'zh_CN'}
          onLanguageChange={handleLanguageChange}
        />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="options-container">
        <div className="page-status">Error loading settings</div>
      </div>
    );
  }

  return (
    <div className="options-container" key={refreshKey}>
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          {toast.type === 'success' ? '✓' : '✕'} {toast.message}
        </div>
      )}
      <header className="options-header">
        <div className="options-logo">
          <img
            src={chrome.runtime.getURL('icons/icon64.png')}
            alt="BrowseBuddy"
          />
        </div>
        <div className="options-title">
          <h1>BrowseBuddy</h1>
          <p>{getMessage('extDescription')}</p>
        </div>
      </header>

      <main className="options-content">
        {/* General Settings */}
        <section className="section">
          <h2 className="section-title">{getMessage('generalSettings') || 'General Settings'}</h2>
          
          <div className="form-group">
            <label className="form-label">{getMessage('language')}</label>
            <p className="form-description">{getMessage('chooseLanguage') || 'Choose your preferred language'}</p>
            {/* Not a tablist - these buttons switch a setting, not a panel. A
                screen reader announced "tab" and looked for tabpanels that do
                not exist. A labelled group of pressed/unpressed buttons is what
                this actually is. */}
            <div className="segmented" role="group" aria-label={getMessage('language')}>
              <button
                className={`segmented-item ${settings.language === 'zh_CN' ? 'active' : ''}`}
                aria-pressed={settings.language === 'zh_CN'}
                onClick={() => handleLanguageChange('zh_CN')}
              >
                简体中文
              </button>
              <button
                className={`segmented-item ${settings.language === 'en' ? 'active' : ''}`}
                aria-pressed={settings.language === 'en'}
                onClick={() => handleLanguageChange('en')}
              >
                English
              </button>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">{getMessage('theme')}</label>
            <p className="form-description">{getMessage('chooseTheme') || 'Select the interface appearance'}</p>
            <div className="segmented" role="group" aria-label={getMessage('theme')}>
              <button
                className={`segmented-item ${settings.theme === 'light' ? 'active' : ''}`}
                aria-pressed={settings.theme === 'light'}
                onClick={() => updateSettings({ theme: 'light' })}
              >
                {getMessage('light')}
              </button>
              <button
                className={`segmented-item ${settings.theme === 'dark' ? 'active' : ''}`}
                aria-pressed={settings.theme === 'dark'}
                onClick={() => updateSettings({ theme: 'dark' })}
              >
                {getMessage('dark')}
              </button>
              <button
                className={`segmented-item ${settings.theme === 'system' ? 'active' : ''}`}
                aria-pressed={settings.theme === 'system'}
                onClick={() => updateSettings({ theme: 'system' })}
              >
                {getMessage('systemDefault') || 'System Default'}
              </button>
            </div>
          </div>
        </section>

        {/* Privacy Settings */}
        <section className="section">
          <h2 className="section-title">{getMessage('privacySettings') || 'Privacy Settings'}</h2>
          
          <ToggleRow
            label={getMessage('realtimeProtection')}
            description={getMessage('realtimeProtectionDesc') || 'Automatically delete history entries matching blacklist patterns'}
            checked={settings.realtimeProtection}
            onChange={() => updateSettings({ realtimeProtection: !settings.realtimeProtection })}
          />

          <ToggleRow
            label={getMessage('privacyReminder') || 'Privacy Reminder'}
            description={getMessage('privacyReminderDesc') || 'Show a badge when visiting a blacklisted site'}
            checked={settings.showPrivacyReminder}
            onChange={() => updateSettings({ showPrivacyReminder: !settings.showPrivacyReminder })}
          />

          <ToggleRow
            label={getMessage('sessionIncognito') || 'Session Incognito Mode'}
            description={getMessage('sessionIncognitoDesc') || 'While enabled, no browsing history is recorded. This session leaves no trace.'}
            checked={settings.sessionIncognito}
            onChange={() => updateSettings({ sessionIncognito: !settings.sessionIncognito })}
          />
        </section>

        {/* Data Management */}
        <section className="section">
          <h2 className="section-title">{getMessage('dataBackup')}</h2>
          
          {storageInfo && (
            <div className="form-group">
              <label className="form-label">{getMessage('storageUsed')}</label>
              <div className="storage-bar">
                <div
                  className={`storage-fill ${storageInfo.used / storageInfo.total > 0.8 ? 'storage-fill-danger' : ''}`}
                  style={{ width: `${Math.min(100, (storageInfo.used / storageInfo.total) * 100)}%` }}
                />
              </div>
              <div className="storage-info">
                <span>{formatBytes(storageInfo.used)} {getMessage('used') || 'used'}</span>
                <span>{formatBytes(storageInfo.total)} {getMessage('total') || 'total'}</span>
              </div>
            </div>
          )}

          <ToggleRow
            label={getMessage('autoCleanup') || 'Auto Cleanup'}
            description={getMessage('autoCleanupDesc') || 'Automatically delete history older than the retention period'}
            checked={settings.autoCleanup}
            onChange={() => updateSettings({ autoCleanup: !settings.autoCleanup })}
          />

          {settings.autoCleanup && (
            <div className="form-group is-spaced">
              <label className="form-label">{getMessage('cleanupRetention') || 'Retention period'}</label>
              <div className="field-row">
                <input
                  type="number"
                  className="form-input is-narrow"
                  min={1}
                  max={3650}
                  value={settings.cleanupRetentionDays}
                  onChange={(e) => {
                    const v = Math.max(1, Math.min(3650, Number(e.target.value) || 1));
                    updateSettings({ cleanupRetentionDays: v });
                  }}
                />
                <span className="field-unit">
                  {getMessage('days') || 'days'}
                </span>
              </div>
            </div>
          )}

          <div className="btn-row">
            <button className="btn btn-primary" onClick={handleBackup}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {getMessage('backup')}
            </button>
            <button className="btn btn-secondary" onClick={handleRestore}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              {getMessage('restore')}
            </button>
          </div>
        </section>

        {/* About */}
        <section className="section">
          <h2 className="section-title">{getMessage('about') || 'About'}</h2>
          <p className="about-text">
            BrowseBuddy v{chrome.runtime.getManifest().version} - {getMessage('extDescription')}
          </p>
          <div className="alert alert-info">
            <strong>{getMessage('privacyPromiseTitle') || 'Privacy Promise:'}</strong>{' '}
            {getMessage('privacyPromise')}
          </div>
        </section>
      </main>

      <footer className="options-footer">
        © 2024 BrowseBuddy. {getMessage('allDataLocal') || 'All data stays on your device.'}
      </footer>
    </div>
  );
};

// Welcome Page Component
const WelcomePage: React.FC<{
  onGetStarted: () => void;
  language: 'en' | 'zh_CN';
  onLanguageChange: (lang: 'en' | 'zh_CN') => void;
}> = ({ onGetStarted, language, onLanguageChange }) => {
  const features = [
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
        </svg>
      ),
      title: getMessage('smartDelete') || 'Smart Delete',
      desc: `${getMessage('deleteByDate')}, ${getMessage('deleteByDomain')}, ${getMessage('deleteByKeyword')}`,
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 3v18h18" />
          <path d="M18 17V9M13 17V5M8 17v-3" />
        </svg>
      ),
      title: getMessage('statistics') || 'Statistics',
      desc: getMessage('statsDesc') || 'Visualize your browsing patterns',
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      ),
      title: getMessage('privacyProtection') || 'Privacy Protection',
      desc: getMessage('blacklistDesc') || 'Blacklist sensitive websites',
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z" />
          <path d="M12 6v6l4 2" />
        </svg>
      ),
      title: getMessage('calendarView'),
      desc: getMessage('localStorageDesc') || 'Your data never leaves your device',
    },
  ];

  return (
    <div className="welcome-container">
      <div className="welcome-language">
        <span>{getMessage('language')}:</span>
        <div className="segmented" role="group" aria-label={getMessage('language')}>
          <button
            className={`segmented-item ${language === 'zh_CN' ? 'active' : ''}`}
            aria-pressed={language === 'zh_CN'}
            onClick={() => onLanguageChange('zh_CN')}
          >
            简体中文
          </button>
          <button
            className={`segmented-item ${language === 'en' ? 'active' : ''}`}
            aria-pressed={language === 'en'}
            onClick={() => onLanguageChange('en')}
          >
            English
          </button>
        </div>
      </div>

      <div className="welcome-logo">
        <img
          src={chrome.runtime.getURL('icons/icon64.png')}
          alt="BrowseBuddy"
        />
      </div>
      <h1 className="welcome-title">{getMessage('welcomeTitle') || 'Welcome to BrowseBuddy!'}</h1>
      <p className="welcome-subtitle">
        {getMessage('welcomeSubtitle') || 'Your personal browser history manager with powerful privacy protection.'}
      </p>

      <div className="welcome-features">
        {features.map((f) => (
          <div key={f.title} className="welcome-feature">
            <div className="welcome-feature-icon">{f.icon}</div>
            <div className="welcome-feature-title">{f.title}</div>
            <div className="welcome-feature-desc">{f.desc}</div>
          </div>
        ))}
      </div>

      <div className="alert alert-info is-left">
        <strong>{getMessage('permissionNotice') || 'Permission Notice:'}</strong>
        <ul className="permission-list">
          <li>{getMessage('permissionHistory') || 'History access - to read and manage your browsing history'}</li>
          <li>{getMessage('permissionStorage') || 'Storage access - to save settings locally'}</li>
          <li>{getMessage('permissionTabs') || 'Tab access - for real-time protection'}</li>
          <li>{getMessage('permissionSessions') || 'Session access - to restore closed tabs'}</li>
        </ul>
      </div>

      <button className="btn btn-primary is-hero" onClick={onGetStarted}>
        {getMessage('getStarted') || 'Get Started'}
      </button>
    </div>
  );
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export default App;
