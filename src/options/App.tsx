import React, { useState, useEffect, useCallback } from 'react';
import { getMessage, setUserLanguage, applyTheme, initI18n } from '../utils/i18n';
import { getSettings, saveSettings, getStorageUsage, createBackup, restoreBackup, type Settings } from '../utils/storage';

type ToastType = 'success' | 'error';

const App: React.FC = () => {
  const [isWelcome, setIsWelcome] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | null>(null);
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
    setSaveStatus('saving');
    
    try {
      await saveSettings(newSettings);
      
      // Apply theme change immediately
      if (updates.theme) {
        applyTheme(updates.theme);
      }
      
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(null), 2000);
    } catch (error) {
      console.error('Failed to save settings:', error);
      setSaveStatus(null);
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
        <div style={{ padding: '40px', textAlign: 'center' }}>{getMessage('loading')}</div>
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
        <div style={{ padding: '40px', textAlign: 'center' }}>Error loading settings</div>
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
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
        </div>
        <div className="options-title">
          <h1>BrowseBuddy</h1>
          <p>{getMessage('extDescription')}</p>
        </div>
        {saveStatus === 'saving' && (
          <span style={{ color: 'var(--text-muted)' }}>{getMessage('loading')}</span>
        )}
        {saveStatus === 'saved' && (
          <span style={{ color: 'var(--success-color)' }}>✓ {getMessage('saved') || 'Saved'}</span>
        )}
      </header>

      <main className="options-content">
        {/* General Settings */}
        <section className="section">
          <h2 className="section-title">{getMessage('generalSettings') || 'General Settings'}</h2>
          
          <div className="form-group">
            <label className="form-label">{getMessage('language')}</label>
            <p className="form-description">{getMessage('chooseLanguage') || 'Choose your preferred language'}</p>
            <div className="segmented" role="tablist">
              <button
                className={`segmented-item ${settings.language === 'zh_CN' ? 'active' : ''}`}
                onClick={() => handleLanguageChange('zh_CN')}
              >
                简体中文
              </button>
              <button
                className={`segmented-item ${settings.language === 'en' ? 'active' : ''}`}
                onClick={() => handleLanguageChange('en')}
              >
                English
              </button>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">{getMessage('theme')}</label>
            <p className="form-description">{getMessage('chooseTheme') || 'Select the interface appearance'}</p>
            <div className="segmented" role="tablist">
              <button
                className={`segmented-item ${settings.theme === 'light' ? 'active' : ''}`}
                onClick={() => updateSettings({ theme: 'light' })}
              >
                {getMessage('light')}
              </button>
              <button
                className={`segmented-item ${settings.theme === 'dark' ? 'active' : ''}`}
                onClick={() => updateSettings({ theme: 'dark' })}
              >
                {getMessage('dark')}
              </button>
              <button
                className={`segmented-item ${settings.theme === 'system' ? 'active' : ''}`}
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
          
          <div className="toggle-wrapper">
            <div className="toggle-info">
              <div className="toggle-label">{getMessage('realtimeProtection')}</div>
              <div className="toggle-description">
                {getMessage('realtimeProtectionDesc') || 'Automatically delete history entries matching blacklist patterns'}
              </div>
            </div>
            <div
              className={`toggle-switch ${settings.realtimeProtection ? 'active' : ''}`}
              onClick={() => updateSettings({ realtimeProtection: !settings.realtimeProtection })}
            >
              <div className="toggle-knob" />
            </div>
          </div>

          <div className="toggle-wrapper">
            <div className="toggle-info">
              <div className="toggle-label">{getMessage('privacyReminder') || 'Privacy Reminder'}</div>
              <div className="toggle-description">
                {getMessage('privacyReminderDesc') || 'Show a badge when visiting a blacklisted site'}
              </div>
            </div>
            <div
              className={`toggle-switch ${settings.showPrivacyReminder ? 'active' : ''}`}
              onClick={() => updateSettings({ showPrivacyReminder: !settings.showPrivacyReminder })}
            >
              <div className="toggle-knob" />
            </div>
          </div>

          <div className="toggle-wrapper">
            <div className="toggle-info">
              <div className="toggle-label">{getMessage('sessionIncognito') || 'Session Incognito Mode'}</div>
              <div className="toggle-description">
                {getMessage('sessionIncognitoDesc') || 'While enabled, no browsing history is recorded. This session leaves no trace.'}
              </div>
            </div>
            <div
              className={`toggle-switch ${settings.sessionIncognito ? 'active' : ''}`}
              onClick={() => updateSettings({ sessionIncognito: !settings.sessionIncognito })}
            >
              <div className="toggle-knob" />
            </div>
          </div>
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

          <div className="toggle-wrapper">
            <div className="toggle-info">
              <div className="toggle-label">{getMessage('autoBackup') || 'Auto Backup'}</div>
              <div className="toggle-description">
                {getMessage('autoBackupDesc') || 'Automatically create backups on a schedule'}
              </div>
            </div>
            <div
              className={`toggle-switch ${settings.autoBackup ? 'active' : ''}`}
              onClick={() => updateSettings({ autoBackup: !settings.autoBackup })}
            >
              <div className="toggle-knob" />
            </div>
          </div>

          {settings.autoBackup && (
            <div className="form-group" style={{ marginTop: '12px' }}>
              <label className="form-label">{getMessage('backupInterval') || 'Backup interval'}</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <input
                  type="number"
                  className="form-input"
                  min={1}
                  max={365}
                  value={settings.backupInterval}
                  onChange={(e) => {
                    const v = Math.max(1, Math.min(365, Number(e.target.value) || 1));
                    updateSettings({ backupInterval: v });
                  }}
                  style={{ maxWidth: '120px' }}
                />
                <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                  {getMessage('days') || 'days'}
                </span>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
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
          <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>
            BrowseBuddy v1.0.0 - {getMessage('extDescription')}
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
        <div className="segmented" role="tablist">
          <button
            className={`segmented-item ${language === 'zh_CN' ? 'active' : ''}`}
            onClick={() => onLanguageChange('zh_CN')}
          >
            简体中文
          </button>
          <button
            className={`segmented-item ${language === 'en' ? 'active' : ''}`}
            onClick={() => onLanguageChange('en')}
          >
            English
          </button>
        </div>
      </div>

      <div className="welcome-logo">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
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

      <div className="alert alert-info" style={{ textAlign: 'left' }}>
        <strong>{getMessage('permissionNotice') || 'Permission Notice:'}</strong>
        <ul style={{ marginTop: '8px', paddingLeft: '20px' }}>
          <li>{getMessage('permissionHistory') || 'History access - to read and manage your browsing history'}</li>
          <li>{getMessage('permissionStorage') || 'Storage access - to save settings locally'}</li>
          <li>{getMessage('permissionTabs') || 'Tab access - for real-time protection'}</li>
          <li>{getMessage('permissionSessions') || 'Session access - to restore closed tabs'}</li>
        </ul>
      </div>

      <button className="btn btn-primary" style={{ padding: '16px 48px', fontSize: '16px' }} onClick={onGetStarted}>
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
