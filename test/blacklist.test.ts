import { describe, it, expect } from 'vitest';
import { extractMainDomain, isUrlBlacklisted, filterBlacklistedItems } from '../src/utils/blacklist';
import type { BlacklistEntry } from '../src/types';

describe('extractMainDomain', () => {
  it('extracts registrable domain from www-prefixed host', () => {
    expect(extractMainDomain('www.example.com')).toBe('example.com');
    expect(extractMainDomain('https://www.example.com/path')).toBe('example.com');
  });

  it('extracts main domain from deep subdomains', () => {
    expect(extractMainDomain('mail.google.com')).toBe('google.com');
    expect(extractMainDomain('a.b.c.example.org')).toBe('example.org');
  });

  it('handles multi-part country TLDs like co.uk / com.cn', () => {
    expect(extractMainDomain('example.co.uk')).toBe('example.co.uk');
    expect(extractMainDomain('www.bbc.co.uk')).toBe('bbc.co.uk');
    expect(extractMainDomain('sub.www.example.com.cn')).toBe('example.com.cn');
    expect(extractMainDomain('example.com.au')).toBe('example.com.au');
    expect(extractMainDomain('a.b.example.co.jp')).toBe('example.co.jp');
  });

  it('handles IP addresses without splitting them', () => {
    expect(extractMainDomain('127.0.0.1')).toBe('127.0.0.1');
    expect(extractMainDomain('192.168.1.1:3000')).toBe('192.168.1.1');
    expect(extractMainDomain('https://10.0.0.1/x')).toBe('10.0.0.1');
  });

  it('handles localhost and single-part hosts', () => {
    expect(extractMainDomain('localhost')).toBe('localhost');
    expect(extractMainDomain('localhost:8080')).toBe('localhost');
    expect(extractMainDomain('intranet-host')).toBe('intranet-host');
  });

  it('returns empty string on invalid URLs', () => {
    expect(extractMainDomain('not a url')).toBe('');
    expect(extractMainDomain('')).toBe('');
  });

  it('handles bare domains (no scheme)', () => {
    expect(extractMainDomain('example.com')).toBe('example.com');
    expect(extractMainDomain('sub.example.org.cn')).toBe('example.org.cn');
  });
});

describe('isUrlBlacklisted', () => {
  const blacklist: BlacklistEntry[] = [
    { id: '1', pattern: 'example.com', type: 'exact', enabled: true, createdAt: 1 },
    { id: '2', pattern: 'blocked.org', type: 'exact', enabled: true, createdAt: 1 },
  ];

  it('matches the exact main domain', () => {
    expect(isUrlBlacklisted('https://example.com', blacklist)).toBe(true);
    expect(isUrlBlacklisted('http://example.com/page', blacklist)).toBe(true);
  });

  it('matches subdomains of a blacklisted main domain', () => {
    expect(isUrlBlacklisted('https://www.example.com', blacklist)).toBe(true);
    expect(isUrlBlacklisted('https://sub.example.com/x', blacklist)).toBe(true);
  });

  it('does not match unrelated domains', () => {
    expect(isUrlBlacklisted('https://example.net', blacklist)).toBe(false);
    expect(isUrlBlacklisted('https://google.com', blacklist)).toBe(false);
  });

  it('respects the enabled flag', () => {
    const disabled: BlacklistEntry[] = [
      { id: '1', pattern: 'example.com', type: 'exact', enabled: false, createdAt: 1 },
    ];
    expect(isUrlBlacklisted('https://example.com', disabled)).toBe(false);
  });

  it('returns false for invalid URLs', () => {
    expect(isUrlBlacklisted('not-a-url', blacklist)).toBe(false);
  });

  it('returns false for empty blacklist', () => {
    expect(isUrlBlacklisted('https://example.com', [])).toBe(false);
  });
});

describe('filterBlacklistedItems', () => {
  const blacklist: BlacklistEntry[] = [
    { id: '1', pattern: 'blocked.com', type: 'exact', enabled: true, createdAt: 1 },
  ];
  const items = [
    { url: 'https://blocked.com/a' },
    { url: 'https://ok.com/b' },
    { url: 'https://sub.blocked.com/c' },
  ];

  it('removes items on blacklisted domains', () => {
    const result = filterBlacklistedItems(items, blacklist);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('https://ok.com/b');
  });

  it('returns all items when blacklist is empty', () => {
    expect(filterBlacklistedItems(items, [])).toHaveLength(3);
  });
});
