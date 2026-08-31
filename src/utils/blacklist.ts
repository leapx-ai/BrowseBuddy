import type { BlacklistEntry } from '../types';

// Country second-level public suffixes and hosting platforms where each
// subdomain is an independent site. Membership is checked on the last two
// labels of the host. Curated, not exhaustive - see extractMainDomain.
const KNOWN_PUBLIC_SUFFIXES = new Set([
  // Country second levels
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
  'co.kr', 'com.br', 'com.tw', 'com.hk', 'com.sg', 'co.in', 'co.nz',
  'com.mx', 'com.my', 'com.tr',
  // Hosting platforms (user subdomains are separate sites)
  'github.io', 'gitlab.io', 'blogspot.com', 'wordpress.com', 'tumblr.com',
  'appspot.com', 'web.app', 'firebaseapp.com', 'vercel.app', 'netlify.app',
  'herokuapp.com', 'azurewebsites.net', 'cloudfront.net', 'myshopify.com',
  'weebly.com', 'wixsite.com', 'livejournal.com',
]);

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

    // Well-known public suffixes: under these, each subdomain is an
    // independent site (user.github.io, shop.blogspot.com), and country
    // second levels make the registrable name three labels deep
    // (example.co.uk). This is a curated list of what actually shows up in
    // browsing history, not the full Public Suffix List - the heuristic it
    // replaces (a generic "co/com/org + short TLD" test) both under-split
    // platform domains and over-split ordinary ones like co.io.
    const lastTwoJoined = lastTwo.join('.');
    if (parts.length >= 3 && KNOWN_PUBLIC_SUFFIXES.has(lastTwoJoined)) {
      return parts.slice(-3).join('.');
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
