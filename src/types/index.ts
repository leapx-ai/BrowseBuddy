// History record types
export interface HistoryItem {
  id: string;
  url: string;
  title: string;
  visitTime: number;
  visitCount: number;
  typedCount?: number;
  lastVisitTime?: number;
}

export interface GroupedHistory {
  [key: string]: HistoryItem[];
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
  type: 'exact' | 'wildcard' | 'regex';
  enabled: boolean;
  createdAt: number;
}

// Settings types
export interface Settings {
  language: 'en' | 'zh_CN';
  theme: 'dark' | 'light' | 'system';
  realtimeProtection: boolean;
  showPrivacyReminder: boolean;
  autoBackup: boolean;
  backupInterval: number; // days
}

// Export types
export interface ExportOptions {
  format: 'csv' | 'html' | 'json';
  dateRange?: {
    start: number;
    end: number;
  };
  domains?: string[];
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
  dateRange: {
    earliest: number;
    latest: number;
  };
  topSites: DomainStats[];
  timeDistribution: TimeDistribution[];
  dailyStats: DailyStats[];
}
