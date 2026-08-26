// History record types
export interface HistoryItem {
  // `${url}:${visitTime}` - stable for the same record and unique across
  // records. It used to be `${visitCount}-${lastVisitTime}`, which identified
  // neither: two different URLs with the same visit count and timestamp
  // collided, and the value changed whenever the visit count did even though it
  // was being used as a React key and as an identity in preview lists.
  // Deliberately equal to the de-duplication key, so identity is defined once.
  id: string;
  url: string;
  title: string;
  // The record's most recent visit. Chrome calls this lastVisitTime; this type
  // used to carry BOTH names holding the same value, and downstream code picked
  // whichever it happened to remember - DeleteModule hid the timestamp entirely
  // when the optional copy was absent.
  visitTime: number;
  visitCount: number;
  typedCount?: number;
  // Primary navigation transition type from getVisits()
  transition?: string;
}

export interface DomainStats {
  domain: string;
  count: number;
  lastVisit: number;
  totalDuration?: number;
}

export interface TimeDistribution {
  hour: number;
  count: number;
}

export interface DailyStats {
  date: string;
  count: number;
}

// Blacklist types
export interface BlacklistEntry {
  id: string;
  pattern: string;
  // Only exact main-domain matching is implemented (isUrlBlacklisted compares
  // `extractMainDomain(url) === pattern`, which already covers subdomains). The
  // union used to also declare 'wildcard' and 'regex', neither of which any code
  // path ever read - so the type advertised matching modes the extension does
  // not have, and a hand-edited backup claiming type: 'regex' was accepted and
  // then silently matched as an exact domain.
  type: 'exact';
  enabled: boolean;
  createdAt: number;
}

// Settings types
export interface Settings {
  language: 'en' | 'zh_CN';
  theme: 'dark' | 'light' | 'system';
  realtimeProtection: boolean;
  showPrivacyReminder: boolean;
  sessionIncognito: boolean;
  autoCleanup: boolean;
  cleanupRetentionDays: number; // keep history newer than this many days
}

// Delete options
export interface DeleteOptions {
  dateRange?: {
    start: number;
    end: number;
  };
  domain?: string;
  keyword?: string;
  regex?: string;
}

// Search options
export interface SearchOptions {
  keyword?: string;
  dateRange?: {
    start: number;
    end: number;
  };
  domains?: string[];
  maxResults?: number;
  transitionType?: string;
}

// Calendar data
export interface CalendarData {
  date: string;
  count: number;
  intensity: number; // 0-1 for heatmap
}

// Statistics
export interface Statistics {
  totalRecords: number;
  totalDomains: number;
  // start/end, matching SearchOptions and DeleteOptions. This was the only
  // date range in the codebase spelled earliest/latest.
  dateRange: {
    start: number;
    end: number;
  };
  topSites: DomainStats[];
  timeDistribution: TimeDistribution[];
  dailyStats: DailyStats[];
}
