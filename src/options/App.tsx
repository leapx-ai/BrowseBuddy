import React, { useState, useEffect, useCallback } from 'react';
import { getMessage, setUserLanguage, applyTheme, initI18n } from '../utils/i18n';
import { getSettings, saveSettings, getStorageUsage, createBackup, restoreBackup, type Settings } from '../utils/storage';

const App: React.FC = () => {
  const [isWelcome, setIsWelcome] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | null>(null);
  const [storageInfo, setStorageInfo] = useState<{ used: number; total: number } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0); // Used to force re-render for i18n

  useEffect(() => {
    // Check if this is the welcome page
    const urlParams = new URLSearchParams(window.location.search);
    setIsWelcome(urlParams.get('welcome') === 'true');
    
    initAndLoadSettings();
    loadStorageInfo();
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
      
      // Apply language change immediately
      if (updates.language) {
        setUserLanguage(updates.language);
        setRefreshKey(prev => prev + 1); // Force re-render
      }
      
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
      alert(getMessage('backup') + ' ' + getMessage('success') || 'Backup successful!');
    } catch (error) {
      alert('Failed to create backup: ' + (error as Error).message);
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
        alert('Restore completed successfully!');
        window.location.reload();
      } catch (error) {
        alert('Failed to restore: ' + (error as Error).message);
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
    return (
      <div className="options-container">
        <WelcomePage onGetStarted={() => setIsWelcome(false)} />
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
            <select
              className="form-select"
              value={settings.language}
              onChange={(e) => updateSettings({ language: e.target.value as 'en' | 'zh_CN' })}
            >
              <option value="zh_CN">简体中文</option>
              <option value="en">English</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">{getMessage('theme')}</label>
            <p className="form-description">{getMessage('chooseTheme') || 'Select the interface appearance'}</p>
            <select
              className="form-select"
              value={settings.theme}
              onChange={(e) => updateSettings({ theme: e.target.value as 'dark' | 'light' | 'system' })}
            >
              <option value="dark">{getMessage('dark')}</option>
              <option value="light">{getMessage('light')}</option>
              <option value="system">{getMessage('systemDefault') || 'System Default'}</option>
            </select>
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
        </section>

        {/* Data Management */}
        <section className="section">
          <h2 className="section-title">{getMessage('dataBackup')}</h2>
          
          {storageInfo && (
            <div className="form-group">
              <label className="form-label">{getMessage('storageUsed')}</label>
              <div className="storage-bar">
                <div
                  className="storage-fill"
                  style={{ width: `${(storageInfo.used / storageInfo.total) * 100}%` }}
                />
              </div>
              <div className="storage-info">
                <span>{formatBytes(storageInfo.used)} {getMessage('used') || 'used'}</span>
                <span>{formatBytes(storageInfo.total)} {getMessage('total') || 'total'}</span>
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
const WelcomePage: React.FC<{ onGetStarted: () => void }> = ({ onGetStarted }) => {
  return (
    <div className="welcome-container">
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
        <div className="welcome-feature">
          <div className="welcome-feature-icon">🗑️</div>
          <div className="welcome-feature-title">{getMessage('smartDelete') || 'Smart Delete'}</div>
          <div className="welcome-feature-desc">{getMessage('deleteByDate')}, {getMessage('deleteByDomain')}, {getMessage('deleteByKeyword')}</div>
        </div>
        <div className="welcome-feature">
          <div className="welcome-feature-icon">📊</div>
          <div className="welcome-feature-title">{getMessage('statistics') || 'Statistics'}</div>
          <div className="welcome-feature-desc">{getMessage('statsDesc') || 'Visualize your browsing patterns'}</div>
        </div>
        <div className="welcome-feature">
          <div className="welcome-feature-icon">🛡️</div>
          <div className="welcome-feature-title">{getMessage('privacyProtection') || 'Privacy Protection'}</div>
          <div className="welcome-feature-desc">{getMessage('blacklistDesc') || 'Blacklist sensitive websites'}</div>
        </div>
        <div className="welcome-feature">
          <div className="welcome-feature-icon">💾</div>
          <div className="welcome-feature-title">{getMessage('localStorage') || 'Local Storage'}</div>
          <div className="welcome-feature-desc">{getMessage('localStorageDesc') || 'Your data never leaves your device'}</div>
        </div>
      </div>

      <div className="alert alert-info" style={{ textAlign: 'left' }}>
        <strong>{getMessage('permissionNotice') || 'Permission Notice:'}</strong>
        <ul style={{ marginTop: '8px', paddingLeft: '20px' }}>
          <li>{getMessage('permissionHistory') || 'History access - to read and manage your browsing history'}</li>
          <li>{getMessage('permissionStorage') || 'Storage access - to save settings locally'}</li>
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
