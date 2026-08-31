import React, { useState, useEffect, useRef, useContext, useCallback, useMemo } from 'react';
import { getMessage, formatDateTime, getCurrentLocale } from '../../utils/i18n';
import { fetchVisibleHistory, groupByDate, groupByDomain, getCalendarData, toLocalDateKey, type HistoryItem, type SearchOptions } from '../../utils/history';
import { getBlacklist, getFavorites, addFavorite, removeFavorite } from '../../utils/storage';
import { extractMainDomain } from '../../utils/blacklist';
import { parseSearchQuery } from '../../utils/search';
import { useSlowLoading } from '../useSlowLoading';
import { Icon } from './Icon';
import SubTabs from './SubTabs';

type ViewMode = 'list' | 'date' | 'domain' | 'calendar';

// Every row carried the full URL including "https://" and "www.", which is the
// same on nearly every row and pushed the part that differs out of view.
function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
}

// Ceiling used by every query on this screen (parseSearchQuery sets the same
// value), so a result set of exactly this size is a truncation, not a total.
const RESULT_CAP = 1000;

const VISIT_TYPE_LABELS: Record<string, string> = {
  typed: 'visitTypeTyped',
  link: 'visitTypeLink',
  auto_toplevel: 'visitTypeAuto',
  reload: 'visitTypeReload',
  form_submit: 'visitTypeForm',
  keyword: 'visitTypeKeyword',
};

// Chips report what actually took effect rather than the raw text: `site:WWW.Foo.com`
// is applied as `foo.com`, and a token with an unparsable date is dropped by the
// parser and so gets no chip.
function buildFilterChips(query: string, transitionType: string): string[] {
  const chips: string[] = [];
  const options = parseSearchQuery(query);

  if (options.keyword) chips.push(`"${options.keyword}"`);
  if (options.domains?.length) chips.push(`site:${options.domains[0]}`);

  for (const token of query.trim().split(/\s+/).filter(Boolean)) {
    const lower = token.toLowerCase();
    if (!lower.startsWith('before:') && !lower.startsWith('after:')) continue;
    const date = token.slice(token.indexOf(':') + 1);
    if (!Number.isNaN(new Date(`${date}T00:00:00`).getTime())) chips.push(lower);
  }

  if (transitionType) {
    chips.push(getMessage(VISIT_TYPE_LABELS[transitionType] || 'allVisitTypes'));
  }
  return chips;
}

// Header label for a day group. "Today"/"Yesterday" are what the user actually
// thinks in; older days get a weekday, which is the other thing people navigate
// history by. The year is only spelled out when it is not the current one.
function dayLabel(ts: number): string {
  const key = toLocalDateKey(ts);
  const now = new Date();
  if (key === toLocalDateKey(now.getTime())) return getMessage('dateToday');

  const yesterday = new Date(now);
  // setDate rather than subtracting 24h, so a DST change does not shift the day.
  yesterday.setDate(yesterday.getDate() - 1);
  if (key === toLocalDateKey(yesterday.getTime())) return getMessage('dateYesterday');

  const date = new Date(ts);
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', weekday: 'short' };
  if (date.getFullYear() !== now.getFullYear()) options.year = 'numeric';
  return date.toLocaleDateString(getCurrentLocale().replace('_', '-'), options);
}

// One shared favorites read for the whole list. Each row used to call
// getFavorites() from its own effect, so a 1000-row result set issued 1000
// chrome.storage reads and every star toggle re-read the list per row.
const FavoritesContext = React.createContext<{
  favorites: Set<string>;
  toggle: (domain: string) => void;
}>({ favorites: new Set(), toggle: () => {} });

// Render a deterministic colored letter avatar for a domain.
// Fully local - no network request, no CSP issues, no domain leaks.
function domainLetter(url: string): string {
  try {
    const host = new URL(url).hostname || '?';
    const letter = host.replace(/^www\./, '').charAt(0).toUpperCase() || '?';
    return letter;
  } catch {
    return '?';
  }
}

function domainColor(url: string): string {
  try {
    const host = new URL(url).hostname;
    let hash = 0;
    for (let i = 0; i < host.length; i++) {
      hash = (hash * 31 + host.charCodeAt(i)) >>> 0;
    }
    // Muted tones rather than the previous fully saturated set. One saturated
    // swatch per row turned the left edge of a 20-row list into confetti that
    // pulled attention away from the titles; these still separate domains at a
    // glance without competing with the text.
    const palette = [
      '#5b6bbf', '#7a5bb5', '#a8588a', '#9a7540',
      '#3f8f6f', '#3f8098', '#a85a52', '#6b8f45',
    ];
    return palette[hash % palette.length];
  } catch {
    return '#5b6bbf';
  }
}

const DomainIcon: React.FC<{ url: string; size?: number }> = ({ url, size = 16 }) => {
  return (
    <div
      className="history-favicon"
      // Decorative: the domain itself is spelled out on the URL line, so the
      // letter is redundant for a screen reader.
      aria-hidden="true"
      // Only the two values a stylesheet cannot know: the requested size and the
      // colour hashed from the domain.
      style={{
        width: size,
        height: size,
        background: domainColor(url),
        fontSize: Math.round(size * 0.6),
      }}
    >
      {domainLetter(url)}
    </div>
  );
};

// Recently closed tabs/windows restore panel
//
// Collapsed to a single line. As a .card with its own title it occupied ~65px at
// the top of the default tab - the tab where the history list is the point.
const RestoreSession: React.FC = () => {
  const [items, setItems] = useState<chrome.sessions.Session[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const showSlowLoading = useSlowLoading(isLoading);

  const loadClosed = async () => {
    setIsLoading(true);
    try {
      const sessions = await chrome.sessions.getRecentlyClosed({ maxResults: 10 });
      setItems(sessions);
    } catch {
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggle = async () => {
    const next = !isOpen;
    setIsOpen(next);
    if (next) {
      await loadClosed();
    }
  };

  const handleRestore = async (sessionId: string) => {
    try {
      await chrome.sessions.restore(sessionId);
      await loadClosed();
    } catch {
      // Session may already be restored
      await loadClosed();
    }
  };

  return (
    <div>
      <button className="inline-toggle" onClick={handleToggle} aria-expanded={isOpen}>
        <span>
          {getMessage('restoreClosedTabs')}
          {items.length > 0 && ` (${items.length})`}
        </span>
        <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={14} />
      </button>

      {isOpen && (
        <div className="gap-below">
          {isLoading && items.length === 0 ? (
            showSlowLoading ? (
              <div className="loading loading-inline">
                <div className="spinner" />
              </div>
            ) : null
          ) : items.length === 0 ? (
            <div className="text-note">
              {getMessage('noClosedTabs')}
            </div>
          ) : (
            <div className="history-list">
              {items.map((session) => {
                const tab = session.tab;
                const window_ = session.window;
                const sessionId = (tab?.sessionId || window_?.sessionId) || '';
                const title = tab
                  ? tab.title || tab.url || ''
                  : window_
                    ? `${window_.tabs?.length || 0} ${getMessage('items')}`
                    : '';
                const url = tab?.url || '';

                return (
                  <button
                    key={session.lastModified}
                    type="button"
                    className="history-item"
                    onClick={() => handleRestore(sessionId)}
                  >
                    {url ? (
                      <DomainIcon url={url} />
                    ) : (
                      <div className="history-favicon history-favicon-blank" />
                    )}
                    <div className="history-content">
                      <div className="history-title">{title || getMessage('closedWindow')}</div>
                      {url && <div className="history-url">{displayUrl(url)}</div>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const ViewModule: React.FC = () => {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [calendarYear, setCalendarYear] = useState(() => new Date().getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(() => new Date().getMonth());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [activeSearch, setActiveSearch] = useState('');
  const [transitionType, setTransitionType] = useState('');
  const [hasLoaded, setHasLoaded] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const showSlowLoading = useSlowLoading(isLoading);
  const debounceTimer = useRef<number | null>(null);

  useEffect(() => {
    getFavorites()
      .then(favs => setFavorites(new Set(favs)))
      .catch(() => {
        // Leave the stars empty rather than claiming nothing is protected.
      });
  }, []);

  const toggleFavorite = useCallback(async (domain: string) => {
    if (!domain) return;
    const wasFav = favorites.has(domain);
    const flip = (add: boolean) => setFavorites(prev => {
      const next = new Set(prev);
      if (add) next.add(domain); else next.delete(domain);
      return next;
    });

    flip(!wasFav); // optimistic - the star reacts on the same frame as the click
    try {
      if (wasFav) await removeFavorite(domain);
      else await addFavorite(domain);
    } catch {
      flip(wasFav); // roll back rather than show a state that was never stored
    }
  }, [favorites]);

  useEffect(() => {
    if (viewMode === 'calendar') return;

    if (debounceTimer.current) {
      window.clearTimeout(debounceTimer.current);
    }
    debounceTimer.current = window.setTimeout(() => {
      setActiveSearch(searchQuery);
    }, 300);

    return () => {
      if (debounceTimer.current) window.clearTimeout(debounceTimer.current);
    };
  }, [searchQuery, viewMode]);

  useEffect(() => {
    if (viewMode === 'calendar') return;
    const options = parseSearchQuery(activeSearch);
    if (transitionType) {
      options.transitionType = transitionType;
    }
    loadHistory(options);
  }, [activeSearch, viewMode, transitionType]);

  const loadHistory = async (options?: SearchOptions) => {
    setIsLoading(true);
    try {
      const blacklist = await getBlacklist();
      const items = await fetchVisibleHistory(options || { maxResults: 1000 }, blacklist);
      setHistory(items);
    } catch (error) {
      console.error('Failed to load history:', error);
    } finally {
      setIsLoading(false);
      setHasLoaded(true);
    }
  };

  // Load history for a specific day when a calendar cell is clicked.
  // No loading indicator - the list updates in place when data arrives.
  const loadDayHistory = async (date: string) => {
    setSelectedDay(date);
    try {
      const blacklist = await getBlacklist();
      const start = new Date(date + 'T00:00:00').getTime();
      const end = start + 24 * 60 * 60 * 1000 - 1;
      const items = await fetchVisibleHistory(
        { maxResults: 1000, dateRange: { start, end } },
        blacklist
      );
      setHistory(items);
    } catch (error) {
      console.error('Failed to load day history:', error);
    }
  };

  const filterChips = buildFilterChips(activeSearch, transitionType);

  const clearFilters = () => {
    setSearchQuery('');
    setTransitionType('');
    setShowFilters(false);
  };

  const renderContent = () => {
    if (viewMode === 'calendar') {
      return (
        <CalendarView
          year={calendarYear}
          month={calendarMonth}
          onPrevMonth={() => setCalendarMonth(prev => {
            if (prev === 0) { setCalendarYear(y => y - 1); return 11; }
            return prev - 1;
          })}
          onNextMonth={() => setCalendarMonth(prev => {
            if (prev === 11) { setCalendarYear(y => y + 1); return 0; }
            return prev + 1;
          })}
          onSelectDay={(date) => loadDayHistory(date)}
          selectedDay={selectedDay}
        />
      );
    }

    // Before the first result set we have nothing to show, so hold the space
    // blank and only fall back to a spinner if the query is actually slow.
    // Afterwards the previous list stays put while a new query runs - swapping
    // it for a spinner made every keystroke and filter change jump the layout.
    if (!hasLoaded) {
      return showSlowLoading ? (
        <div className="loading">
          <div className="spinner" />
          {getMessage('loading')}
        </div>
      ) : null;
    }

    if (history.length === 0) {
      return (
        <div className="empty-state">
          <div className="empty-icon"><Icon name="inbox" size={40} /></div>
          <div className="empty-title">{getMessage('noHistoryFound')}</div>
          <div className="empty-desc">{getMessage('tryAdjustingSearch')}</div>
        </div>
      );
    }

    // The stale list stays interactive for fast reloads; if a query really is
    // slow, dim it so the wait is visible without collapsing the layout.
    return (
      <div className={showSlowLoading ? 'is-stale' : undefined}>
        {viewMode === 'date' && <DateGroupView items={history} />}
        {viewMode === 'domain' && <DomainGroupView items={history} />}
        {viewMode === 'list' && <ListView items={history} />}
      </div>
    );
  };

  return (
    <FavoritesContext.Provider value={{ favorites, toggle: toggleFavorite }}>
      {/* Restore recently closed tabs */}
      <RestoreSession />

      {/* Search and filters share one row */}
      <div className="toolbar">
        <div className="search-field">
          <input
            type="text"
            className="input"
            placeholder={getMessage('searchPlaceholderAdvanced')}
            aria-label={getMessage('searchLabel')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {/* Getting back to the full list used to mean select-all then delete. */}
          {searchQuery && (
            <button
              className="search-clear"
              onClick={() => setSearchQuery('')}
              aria-label={getMessage('clearSearch')}
              title={getMessage('clearSearch')}
            >
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
        {viewMode !== 'calendar' && (
          <button
            className={`icon-btn ${showFilters ? 'active' : ''} ${transitionType ? 'icon-btn-dot' : ''}`}
            onClick={() => setShowFilters(v => !v)}
            aria-expanded={showFilters}
            aria-label={getMessage('filterByVisitType')}
            title={getMessage('filterByVisitType')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
            </svg>
          </button>
        )}
      </div>

      {/*
        The visit-type selector and the query-syntax hint only take space when the
        filter panel is open or a filter is actually narrowing the results. Kept
        permanently visible they cost ~70px before the first row - and the hint
        appearing on the first keystroke shifted the whole list down.
      */}
      {viewMode !== 'calendar' && (showFilters || transitionType) && (
        <div className="gap-below">
          <select
            className="input"
            value={transitionType}
            onChange={(e) => setTransitionType(e.target.value)}
          >
            <option value="">{getMessage('allVisitTypes')}</option>
            <option value="typed">{getMessage('visitTypeTyped')}</option>
            <option value="link">{getMessage('visitTypeLink')}</option>
            <option value="auto_toplevel">{getMessage('visitTypeAuto')}</option>
            <option value="reload">{getMessage('visitTypeReload')}</option>
            <option value="form_submit">{getMessage('visitTypeForm')}</option>
            <option value="keyword">{getMessage('visitTypeKeyword')}</option>
          </select>
          {showFilters && (
            <div className="field-hint">
              {getMessage('searchSyntaxHint')}
            </div>
          )}
        </div>
      )}

      {/* View Mode Tabs */}
      <SubTabs
        label={getMessage('navView')}
        activeId={viewMode}
        onChange={setViewMode}
        items={[
          { id: 'list', label: getMessage('listView') },
          { id: 'date', label: getMessage('groupByDate') },
          { id: 'domain', label: getMessage('groupByDomain') },
          { id: 'calendar', label: getMessage('calendarView') },
        ]}
      />

      {/* What is on screen right now, and what produced it */}
      {viewMode !== 'calendar' && hasLoaded && history.length > 0 && (
        <div className="result-bar">
          <span className="result-count">
            {getMessage('resultSummary', [
              // maxResults truncates the query, so at the cap the real total is
              // unknown - say "1000+" rather than claim an exact figure.
              history.length >= RESULT_CAP ? `${RESULT_CAP}+` : String(history.length),
              String(new Set(history.map(i => extractMainDomain(i.url))).size),
            ])}
          </span>
          {filterChips.map(chip => (
            <span key={chip} className="chip" title={chip}>{chip}</span>
          ))}
          {filterChips.length > 0 && (
            <button className="chip-clear" onClick={clearFilters}>
              {getMessage('clearFilters')}
            </button>
          )}
        </div>
      )}

      {/* Content */}
      {renderContent()}

      {/* Day detail below calendar */}
      {viewMode === 'calendar' && selectedDay && (
        <div className="day-detail">
          <div className="row-between gap-below">
            <h3 className="card-title is-flush">{selectedDay}</h3>
            <button className="btn btn-sm btn-secondary" onClick={() => setSelectedDay(null)}>
              {getMessage('close')}
            </button>
          </div>
          <div className="day-history-list">
            {history.length > 0 ? (
              /* The day is already stated in the heading above, so per-day
                 headers inside would repeat it on every row group. */
              <ListView items={history} showDateHeaders={false} />
            ) : (
              <div className="empty-state">
                <div className="empty-icon"><Icon name="inbox" size={40} /></div>
                <div className="empty-title">{getMessage('noHistoryFound')}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </FavoritesContext.Provider>
  );
};

// Calendar Heatmap View
const CalendarView: React.FC<{
  year: number;
  month: number;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onSelectDay: (date: string) => void;
  selectedDay: string | null;
}> = ({ year, month, onPrevMonth, onNextMonth, onSelectDay, selectedDay }) => {
  const [data, setData] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [maxCount, setMaxCount] = useState(1);
  const showSlowLoading = useSlowLoading(isLoading);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    // The blacklist is supplied here rather than read inside history.ts - the
    // history module is the browser-API layer and does not read storage.
    // getBlacklist is cached, so a month flip costs one lookup, not one read.
    getBlacklist()
      .then(blacklist => getCalendarData(year, month, blacklist))
      .then(entries => {
      if (cancelled) return;
      const map: Record<string, number> = {};
      let max = 1;
      entries.forEach(e => {
        map[e.date] = e.count;
        if (e.count > max) max = e.count;
      });
      setData(map);
      setMaxCount(max);
      setIsLoading(false);
    }).catch(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, [year, month]);

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = new Date(year, month, 1).toLocaleDateString(
    getCurrentLocale().replace('_', '-'),
    { year: 'numeric', month: 'long' }
  );

  const cells: (string | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    // Same day-key rule as the heat-map data it is matched against. Spelled out
    // inline here, it was the third implementation of that format in the repo.
    cells.push(toLocalDateKey(new Date(year, month, d).getTime()));
  }
  // Always six weeks. A month that starts on a Sunday and has 30 days fits in
  // five rows, one starting on a Saturday needs six - so without the padding the
  // grid changed height as you paged through months, and the legend and the day
  // detail under it moved with it.
  while (cells.length < 42) cells.push(null);

  // Local calendar date - toISOString() would resolve to the UTC day and mark
  // the wrong cell as "today" for any non-UTC timezone.
  const today = toLocalDateKey(Date.now());

  // Brand indigo, the same hue as the rest of the panel - a green heatmap next
  // to an indigo UI read as a third product's chart.
  const heatColor = (count: number) =>
    count > 0
      ? `rgba(99, 102, 241, ${0.25 + 0.75 * (count / maxCount)})`
      : 'var(--bg-tertiary)';

  /*
   * No early return before the first month arrives.
   *
   * This used to hold the space blank by returning null, which does not hold any
   * space: switching to the calendar collapsed the pane to just the segmented
   * control, then a few milliseconds later ~300px of grid and legend appeared -
   * the jump that reads as the view shaking as it opens.
   *
   * The grid's geometry does not depend on the data at all: the month label, the
   * day numbers and the six rows are all derived from year/month. So it renders
   * immediately at its final size with every day at the zero-visit colour, and the
   * heat fills in when the query lands. Only if that wait becomes visible does the
   * grid dim, via .is-stale, which changes no metrics.
   */

  return (
    <div>
      <div className="row-between gap-below">
        <button className="btn btn-sm btn-secondary" onClick={onPrevMonth}>‹</button>
        <span className="calendar-month">{monthLabel}</span>
        <button className="btn btn-sm btn-secondary" onClick={onNextMonth}>›</button>
      </div>
      <div
        className={`calendar-grid ${showSlowLoading ? 'is-stale' : ''}`}
        aria-busy={isLoading}
      >
        {cells.map((date, i) => {
          if (!date) return <div key={`empty-${i}`} className="calendar-cell calendar-cell-empty" />;
          const count = data[date] || 0;
          const isSelected = date === selectedDay;
          const isToday = date === today;
          return (
            <button
              key={date}
              type="button"
              className={`calendar-cell ${isSelected ? 'calendar-cell-selected' : ''} ${isToday ? 'calendar-cell-today' : ''}`}
              style={{ background: heatColor(count) }}
              title={`${date}: ${count} ${getMessage('visits')}`}
              aria-label={`${date}: ${count} ${getMessage('visits')}`}
              aria-pressed={isSelected}
              onClick={() => onSelectDay(date)}
            >
              {Number(date.slice(-2))}
            </button>
          );
        })}
      </div>
      {/* Colour scale is meaningless without a key. */}
      <div className="heatmap-legend">
        <span>{getMessage('heatmapLess')}</span>
        {[0, 0.25, 0.5, 0.75, 1].map((step) => (
          <span
            key={step}
            className="heatmap-swatch"
            style={{ background: heatColor(step * maxCount) }}
          />
        ))}
        <span>{getMessage('heatmapMore')}</span>
      </div>
    </div>
  );
};

// List View Component
//
// Two things happen here that a plain map() did not do:
//  - consecutive rows from the same local day get one sticky header, so the date
//    is stated once instead of on every row, and each row keeps only HH:MM;
//  - rows are appended in pages. A 1000-record result set used to build 1000 rows
//    up front, which is the slowest moment of opening the popup and most of it is
//    never scrolled to.
const LIST_PAGE_SIZE = 60;

const ListView: React.FC<{ items: HistoryItem[]; showDateHeaders?: boolean }> = ({
  items,
  showDateHeaders = true,
}) => {
  const [visibleCount, setVisibleCount] = useState(LIST_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // A new result set starts from the top again.
  useEffect(() => {
    setVisibleCount(LIST_PAGE_SIZE);
  }, [items]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || visibleCount >= items.length) return;
    // rootMargin so the next page is in place before the sentinel is reached.
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          setVisibleCount(c => Math.min(c + LIST_PAGE_SIZE, items.length));
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visibleCount, items.length]);

  // Counted over the whole result set, not over the rendered slice - otherwise
  // the number under a day anchor would grow while paging in more rows.
  const dayCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (!showDateHeaders) return counts;
    for (const item of items) {
      const key = toLocalDateKey(item.visitTime);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }, [items, showDateHeaders]);

  let lastDateKey = '';

  return (
    <>
      <div className="history-list">
        {items.slice(0, visibleCount).map((item, index) => {
          const dateKey = toLocalDateKey(item.visitTime);
          const needsHeader = showDateHeaders && dateKey !== lastDateKey;
          lastDateKey = dateKey;
          return (
            <React.Fragment key={`${item.url}-${index}`}>
              {needsHeader && (
                <div className="list-date-header">
                  <span>{dayLabel(item.visitTime)}</span>
                  <span className="list-date-count">
                    {dayCounts.get(dateKey)} {getMessage('items')}
                  </span>
                </div>
              )}
              <HistoryListItem item={item} showDate={!showDateHeaders} />
            </React.Fragment>
          );
        })}
      </div>
      {visibleCount < items.length && (
        <div ref={sentinelRef} className="list-sentinel" aria-hidden="true" />
      )}
    </>
  );
};

// Truncated group that can be opened in place. The count used to be printed as
// plain text with no way to reach the records it referred to.
const CollapsibleGroup: React.FC<{
  items: HistoryItem[];
  limit: number;
  showDate?: boolean;
}> = ({ items, limit, showDate = true }) => {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, limit);

  return (
    <div className="history-list">
      {visible.map((item, index) => (
        <HistoryListItem key={`${item.url}-${index}`} item={item} showDate={showDate} />
      ))}
      {items.length > limit && (
        <button className="list-expander" onClick={() => setExpanded(v => !v)} aria-expanded={expanded}>
          {expanded
            ? getMessage('collapseList')
            : getMessage('showAllCount', String(items.length))}
        </button>
      )}
    </div>
  );
};

// Date Group View
const DateGroupView: React.FC<{ items: HistoryItem[] }> = ({ items }) => {
  const grouped = groupByDate(items);
  const sortedDates = Array.from(grouped.keys()).sort((a: string, b: string) => b.localeCompare(a));

  return (
    <div>
      {sortedDates.map((date) => (
        <div key={date} className="card">
          <div className="card-title row-between">
            <span>{date}</span>
            <span className="group-count">
              {grouped.get(date)?.length} {getMessage('items')}
            </span>
          </div>
          <CollapsibleGroup items={grouped.get(date) || []} limit={5} showDate={false} />
        </div>
      ))}
    </div>
  );
};

// Domain Group View
const DomainGroupView: React.FC<{ items: HistoryItem[] }> = ({ items }) => {
  const grouped = groupByDomain(items);
  const sortedDomains = Array.from(grouped.entries())
    .sort((a: [string, HistoryItem[]], b: [string, HistoryItem[]]) => b[1].length - a[1].length);

  return (
    <div>
      {sortedDomains.map(([domain, domainItems]: [string, HistoryItem[]]) => (
        <div key={domain} className="card">
          <div className="card-title row-between">
            <span className="row-inline">
              <DomainIcon url={`https://${domain}`} />
              <span className="truncate">{domain}</span>
            </span>
            <span className="group-meta">
              {/* Most recent visit for this domain - the counts alone did not say
                  whether a domain is current or months stale. */}
              <span className="group-recent">
                {formatDateTime(Math.max(...domainItems.map(i => i.visitTime)))}
              </span>
              <span className="count-badge">
                {domainItems.length}
              </span>
            </span>
          </div>
          <CollapsibleGroup items={domainItems} limit={3} showDate={false} />
        </div>
      ))}
    </div>
  );
};

// Single History Item
const HistoryListItem: React.FC<{ item: HistoryItem; showDate?: boolean }> = ({ item, showDate = true }) => {
  const { favorites, toggle } = useContext(FavoritesContext);
  const mainDomain = extractMainDomain(item.url);
  const isFav = favorites.has(mainDomain);

  // A real link, so the row joins the tab order, opens on Enter, and supports
  // Cmd/Ctrl-click, middle-click and "copy link address" - all of which a
  // div+onClick silently swallowed. Plain activation is still routed through
  // chrome.tabs.create to keep the existing behaviour.
  const handleClick = (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    chrome.tabs.create({ url: item.url });
  };

  const handleToggleFav = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toggle(mainDomain);
  };

  const timeLabel = showDate
    ? formatDateTime(item.visitTime)
    : new Date(item.visitTime).toLocaleTimeString(getCurrentLocale().replace('_', '-'), {
        hour: '2-digit',
        minute: '2-digit',
      });

  return (
    <a
      className="history-item"
      href={item.url}
      target="_blank"
      rel="noreferrer"
      onClick={handleClick}
    >
      <DomainIcon url={item.url} />
      <div className="history-content">
        <div className="history-title">{item.title || '(No title)'}</div>
        <div className="history-url">{displayUrl(item.url)}</div>
      </div>
      <div className="history-meta">
        <span className="history-time">{timeLabel}</span>
        <button
          className={`fav-btn ${isFav ? 'fav-btn-active' : ''}`}
          onClick={handleToggleFav}
          aria-pressed={isFav}
          aria-label={isFav ? getMessage('removeFromFavorites') : getMessage('addToFavorites')}
          title={isFav ? getMessage('removeFromFavorites') : getMessage('addToFavorites')}
        >
          <Icon name={isFav ? 'star-filled' : 'star'} size={15} />
        </button>
      </div>
    </a>
  );
};

export default ViewModule;
