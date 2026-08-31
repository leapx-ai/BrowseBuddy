// Internationalization utilities with user language preference support

import { getSettings } from './storage';

// Message cache for fallback. Stores the message text plus the placeholders
// definition so named placeholders ($count$) can be resolved like chrome.i18n.
interface CachedMessage {
  message: string;
  placeholders?: Record<string, { content: string }>;
}
const messagesCache: Record<string, Record<string, CachedMessage>> = {
  en: {},
  zh_CN: {},
};

let currentLanguage: string | null = null;

// Load all messages from the extension's _locales
async function loadMessages(locale: string): Promise<Record<string, CachedMessage>> {
  try {
    // Try to fetch the messages.json directly
    const response = await fetch(chrome.runtime.getURL(`_locales/${locale}/messages.json`));
    if (response.ok) {
      const messages = await response.json();
      // Flatten to { message, placeholders } keeping the placeholders definition
      const flattened: Record<string, CachedMessage> = {};
      for (const [key, value] of Object.entries(messages)) {
        if (typeof value === 'object' && value !== null && 'message' in value) {
          const m = value as { message: string; placeholders?: Record<string, { content: string }> };
          flattened[key] = {
            message: m.message,
            placeholders: m.placeholders,
          };
        }
      }
      return flattened;
    }
  } catch {
    // Fallback to chrome.i18n if fetch fails
  }
  return {};
}

// Initialize messages cache
export async function initI18n(): Promise<void> {
  const settings = await getSettings();
  currentLanguage = settings.language;
  
  // Set HTML lang attribute for browser native controls
  if (typeof document !== 'undefined') {
    document.documentElement.lang = toBCP47Locale(settings.language);
  }
  
  // Load both language packs
  messagesCache.en = await loadMessages('en');
  messagesCache.zh_CN = await loadMessages('zh_CN');
}

// Get current language setting
export async function getUserLanguage(): Promise<string> {
  if (currentLanguage) return currentLanguage;
  const settings = await getSettings();
  currentLanguage = settings.language;
  return currentLanguage;
}

// Set current language (for runtime updates)
export function setUserLanguage(lang: string): void {
  currentLanguage = lang;
  // Set HTML lang attribute for browser native controls (date input, etc.)
  if (typeof document !== 'undefined') {
    document.documentElement.lang = toBCP47Locale(lang);
  }
}

// Get message with user language preference support.
// Supports both numeric ($1$, $2$) and named ($count$) placeholders.
// Named placeholders are resolved through the message's placeholders map,
// whose content is "$N" referencing the substitution index.
export function getMessage(messageName: string, substitutions?: string | string[]): string {
  const lang = currentLanguage || 'zh_CN';
  const subs = substitutions === undefined ? [] : Array.isArray(substitutions) ? substitutions : [substitutions];

  // First try from cache
  const cached = messagesCache[lang]?.[messageName];
  if (cached) {
    let text = cached.message;

    // Resolve named placeholders first ($name$ -> placeholder content "$N" -> subs[N-1])
    if (cached.placeholders) {
      text = text.replace(/\$([A-Za-z_][A-Za-z0-9_]*)\$/g, (match, name) => {
        const ph = cached.placeholders?.[name];
        if (!ph) return match;
        const idxMatch = /^\$(\d+)$/.exec(ph.content);
        if (!idxMatch) return ph.content;
        const idx = parseInt(idxMatch[1], 10) - 1;
        return subs[idx] !== undefined ? subs[idx] : match;
      });
    }

    // Resolve numeric placeholders ($1$, $2$)
    text = text.replace(/\$(\d+)\$/g, (match, index) => {
      const idx = parseInt(index, 10) - 1;
      return subs[idx] !== undefined ? subs[idx] : match;
    });

    return text;
  }

  // Fallback to chrome.i18n
  if (typeof chrome !== 'undefined' && chrome.i18n) {
    const message = chrome.i18n.getMessage(messageName, substitutions);
    if (message) return message;
  }
  
  // Final fallback: return the key itself
  return messageName;
}

// Convert internal locale format to BCP 47 format for Intl API
function toBCP47Locale(locale: string): string {
  // Convert zh_CN to zh-CN, en to en
  return locale.replace('_', '-');
}

export function getCurrentLocale(): string {
  return currentLanguage || 'zh_CN';
}

// Get locale in BCP 47 format for Intl API
function getCurrentBCP47Locale(): string {
  return toBCP47Locale(getCurrentLocale());
}

// Helper to format dates according to locale
export function formatDate(timestamp: number, locale?: string): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString(locale || getCurrentBCP47Locale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(timestamp: number, locale?: string): string {
  const date = new Date(timestamp);
  return date.toLocaleString(locale || getCurrentBCP47Locale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Helper to format numbers
export function formatNumber(num: number): string {
  return new Intl.NumberFormat(getCurrentBCP47Locale()).format(num);
}

// Format duration in seconds to human readable.
// Uses zh units when the current language is Chinese, otherwise en.
export function formatDuration(seconds: number): string {
  const isZh = (currentLanguage || 'zh_CN').startsWith('zh');
  if (seconds < 60) {
    return isZh ? `${seconds}秒` : `${seconds}s`;
  }
  if (seconds < 3600) {
    return isZh ? `${Math.floor(seconds / 60)}分钟` : `${Math.floor(seconds / 60)}m`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (mins === 0) {
    return isZh ? `${hours}小时` : `${hours}h`;
  }
  return isZh ? `${hours}小时${mins}分` : `${hours}h ${mins}m`;
}
