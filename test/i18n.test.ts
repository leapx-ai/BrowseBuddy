import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setUserLanguage, formatDuration, getMessage, initI18n } from '../src/utils/i18n';

describe('formatDuration', () => {
  beforeEach(() => {
    setUserLanguage('en');
  });

  it('formats seconds', () => {
    expect(formatDuration(30)).toBe('30s');
  });

  it('formats minutes', () => {
    expect(formatDuration(120)).toBe('2m');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(3661)).toBe('1h 1m');
  });

  it('formats exact hours without minutes', () => {
    expect(formatDuration(7200)).toBe('2h');
  });

  it('uses Chinese units when language is zh', () => {
    setUserLanguage('zh_CN');
    expect(formatDuration(30)).toBe('30秒');
    expect(formatDuration(120)).toBe('2分钟');
    expect(formatDuration(3661)).toBe('1小时1分');
    expect(formatDuration(7200)).toBe('2小时');
  });
});

describe('getMessage', () => {
  beforeEach(() => {
    setUserLanguage('en');
    // Ensure initI18n reads "en" from storage (default is zh_CN).
    const chrome = (globalThis as unknown as { chrome: any }).chrome;
    chrome.storage.local.set({
      browsebuddy_settings: { language: 'en', theme: 'dark', realtimeProtection: true, showPrivacyReminder: true, autoBackup: false, backupInterval: 7, sessionIncognito: false, autoCleanup: false, cleanupRetentionDays: 30 },
    });
    // Stub fetch so initI18n can load a small fake message pack.
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      const locale = url.includes('zh_CN') ? 'zh_CN' : 'en';
      const messages = locale === 'zh_CN'
        ? {
            testKey: { message: '中文 $1$' },
            plainKey: { message: '纯文本' },
            namedKey: { message: '删除 $count$ 条', placeholders: { count: { content: '$1' } } },
          }
        : {
            testKey: { message: 'Hello $1$' },
            plainKey: { message: 'Plain' },
            namedKey: { message: 'Delete $count$ records', placeholders: { count: { content: '$1' } } },
          };
      return Promise.resolve({ ok: true, json: () => Promise.resolve(messages) } as Response);
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns translated message after initI18n', async () => {
    await initI18n();
    expect(getMessage('plainKey')).toBe('Plain');
  });

  it('replaces $1$ substitution', async () => {
    await initI18n();
    expect(getMessage('testKey', 'World')).toBe('Hello World');
  });

  it('replaces array substitutions', async () => {
    await initI18n();
    expect(getMessage('testKey', ['Bob'])).toBe('Hello Bob');
  });

  it('keeps placeholder when no substitution given', async () => {
    await initI18n();
    expect(getMessage('testKey')).toBe('Hello $1$');
  });

  it('resolves named placeholders ($count$)', async () => {
    await initI18n();
    expect(getMessage('namedKey', '5')).toBe('Delete 5 records');
  });

  it('keeps named placeholder when no substitution given', async () => {
    await initI18n();
    expect(getMessage('namedKey')).toBe('Delete $count$ records');
  });

  it('uses zh_CN pack when language is Chinese', async () => {
    const chrome = (globalThis as unknown as { chrome: any }).chrome;
    await chrome.storage.local.set({
      browsebuddy_settings: { language: 'zh_CN', theme: 'dark', realtimeProtection: true, showPrivacyReminder: true, autoBackup: false, backupInterval: 7, sessionIncognito: false, autoCleanup: false, cleanupRetentionDays: 30 },
    });
    await initI18n();
    expect(getMessage('testKey', '世界')).toBe('中文 世界');
  });
});
