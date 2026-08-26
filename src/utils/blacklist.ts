import type { BlacklistEntry } from '../types';

// Extract main domain from URL or hostname
// e.g., "www.xchina.co" -> "xchina.co", "sub.www.example.com.cn" -> "example.com.cn"
export function extractMainDomain(url: string): string {
  try {
    // Normalize through the URL parser so ports, IPv6 brackets and
    // raw hostname input are all handled correctly. The trailing root label is
    // stripped too: "example.com." is the same host as "example.com", but as a
    // distinct string it slipped past both blacklist matching and the favorites
    // deletion guard, which compare for equality.
    const hostname = normalizeHost(
      url.includes('://') ? new URL(url).hostname : new URL(`https://${url}`).hostname
    );
    const parts = hostname.split('.');
    const lastTwo = parts.slice(-2);

    // IP addresses: never treat them as domain names to split.
    // This covers IPv4 and the common IPv6 forms (e.g. ::1, [::1]).
    const isIpLike =
      /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(':');

    // Single-part hostnames (localhost, intranet names)
    if (parts.length === 1 || isIpLike) {
      return hostname;
    }

    // Handle special cases like .co.uk, .com.cn, .org.cn, .net.cn, .gov.cn, .ac.uk, etc.
    const specialTlds = ['co', 'com', 'org', 'net', 'gov', 'ac', 'edu', 'mil'];

    if (parts.length >= 3) {
      // Check if it's a special TLD pattern (e.g., example.co.uk)
      if (specialTlds.includes(lastTwo[0]) && lastTwo[1].length <= 3) {
        return parts.slice(-3).join('.');
      }
    }
    
    // Standard case: last two parts are the main domain
    return parts.slice(-2).join('.');
  } catch {
    // Invalid URL/hostname - return empty so callers can detect failure
    return '';
  }
}

// Hostnames may carry a trailing root label ("example.com."), which is a
// different string but the same host. Normalize before any comparison.
function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/\.+$/, '');
}

// True when `hostname` is exactly `domain` or a subdomain of it.
// Substring matching would make "test.com" match "latest.com" - harmless in a
// search box, but on the delete path it silently destroys unrelated history.
export function hostMatchesDomain(hostname: string, domain: string): boolean {
  const host = normalizeHost(hostname);
  const target = normalizeHost(domain);
  if (!host || !target) return false;
  return host === target || host.endsWith(`.${target}`);
}

// Browser-internal pages, which have no domain worth blacklisting, favouriting
// or timing.
//
// One list, because the three call sites used to carry three different ones:
// the privacy page's blacklist button checked four schemes, its favourites
// button only chrome://, and the background worker's dwell timer only chrome://
// and chrome-extension://. So an extension page could be favourited but not
// blacklisted, and about: pages accumulated dwell time.
const INTERNAL_SCHEMES = [
  'chrome://',
  'chrome-extension://',
  'about:',
  'edge://',
  'moz-extension://',
  'devtools://',
  'view-source:',
];

export function isInternalUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  return INTERNAL_SCHEMES.some(scheme => url.startsWith(scheme));
}

// Check if URL matches blacklist
// Now all entries are main domains and match any subdomain of that domain
export function isUrlBlacklisted(url: string, blacklist: BlacklistEntry[]): boolean {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    const mainDomain = extractMainDomain(hostname);
    
    return blacklist.some(entry => {
      if (!entry.enabled) return false;
      // Entry pattern is the main domain, check if URL's main domain matches
      return mainDomain === entry.pattern;
    });
  } catch {
    return false;
  }
}

// Filter out any history items belonging to blacklisted domains
export function filterBlacklistedItems<T extends { url: string }>(
  items: T[],
  blacklist: BlacklistEntry[]
): T[] {
  if (blacklist.length === 0) return items;
  return items.filter(item => !isUrlBlacklisted(item.url, blacklist));
}
