// Theme management: dark / light / follow-the-OS.
//
// Split out of i18n.ts, where it had no business being - language and theme
// only ever met in the settings object. Both UI surfaces import from here.

import { getSettings } from './storage';

// One MediaQueryList for the life of the context and one stable handler.
// applyTheme used to create a fresh MediaQueryList on every call just to
// remove the old listener from it, which depends on the browser not caring
// about instance identity - it happens to work, but it is not a contract.
const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
const onSystemThemeChange = () => applyTheme('system');
let followingSystem = false;

export function applyTheme(theme: 'dark' | 'light' | 'system'): void {
  const effectiveTheme =
    theme === 'system' ? (systemThemeQuery.matches ? 'dark' : 'light') : theme;
  document.documentElement.setAttribute('data-theme', effectiveTheme);

  // In "system" mode, follow OS theme changes live.
  if (theme === 'system' && !followingSystem) {
    systemThemeQuery.addEventListener?.('change', onSystemThemeChange);
    followingSystem = true;
  } else if (theme !== 'system' && followingSystem) {
    systemThemeQuery.removeEventListener?.('change', onSystemThemeChange);
    followingSystem = false;
  }
}

// Initialize theme on page load
export async function initTheme(): Promise<void> {
  const settings = await getSettings();
  applyTheme(settings.theme);
}
