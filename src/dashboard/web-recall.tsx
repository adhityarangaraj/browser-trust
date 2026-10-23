import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  BookmarkCheck,
  Calendar,
  Clock3,
  ExternalLink,
  FileText,
  Hash,
  Pencil,
  RotateCcw,
  Search,
  StickyNote,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import './web-recall.css';
import { normalizeWebHost } from '../core/activity-time';
import { getHistoryRange, type HistoryPeriod } from './history';
import { rankItems, type RankableItem } from './recall-ranking';
import {
  addRecentSearch,
  clearRecentSearches,
  deleteRecallItem,
  listRecallItems,
  loadRecentSearches,
  saveRecallItem,
  searchRecallItems,
  unsaveRecallByUrl,
  updateRecallItem,
  type RecallItem,
} from './recall-store';

type RecallTab = 'search' | 'saved';
type RecallSort = 'relevance' | 'recent' | 'visits';
type RecallPeriod = HistoryPeriod | 'All';
type HistoryStatus = 'checking' | 'permission' | 'loading' | 'ready' | 'error';

const PERIODS: readonly RecallPeriod[] = ['Today', 'Last 7 days', 'Last 30 days', 'All'];
const PAGE_SIZE = 30;

interface HistoryResult extends RankableItem {
  /** Favicon URL via chrome://favicon2 */
  faviconUrl?: string;
}

/** Exclude extension pages and browser-internal URLs */
function isUserPage(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function faviconUrl(pageUrl: string): string | undefined {
  try {
    const u = new URL(pageUrl);
    return `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(u.origin)}&size=32`;
  } catch {
    return undefined;
  }
}

function formatRelativeTime(timestamp: number, now: number): string {
  const diff = now - timestamp;
  if (diff < 60_000) return 'just now';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(timestamp);
}

function formatDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);
}

export function WebRecall() {
  const [tab, setTab] = useState<RecallTab>('search');
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [period, setPeriod] = useState<RecallPeriod>('Last 30 days');
  const [sortKey, setSortKey] = useState<RecallSort>('relevance');
  const [domainFilter, setDomainFilter] = useState('');
  const [status, setStatus] = useState<HistoryStatus>('checking');
  const [historyError, setHistoryError] = useState('');
  const [results, setResults] = useState<HistoryResult[]>([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [savedItems, setSavedItems] = useState<RecallItem[]>([]);
  const [savedQuery, setSavedQuery] = useState('');
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [showRecent, setShowRecent] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNote, setEditNote] = useState('');
  const [editTags, setEditTags] = useState('');
  const [requestPending, setRequestPending] = useState(false);
  const [now] = useState(Date.now);
  const searchRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Load saved items and recent searches on mount
  useEffect(() => {
    void listRecallItems().then(setSavedItems).catch(() => undefined);
    void loadRecentSearches().then(setRecentSearches).catch(() => undefined);
  }, []);

  // Close recent-searches dropdown on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowRecent(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Check history permission on mount
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const allowed = await chrome.permissions.contains({ permissions: ['history'] });
        if (!cancelled) setStatus(allowed ? 'ready' : 'permission');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const searchHistory = useCallback(async (
    searchQuery: string,
    searchPeriod: RecallPeriod,
    permissionGrantedForRequest = false,
  ) => {
    if (status !== 'ready' && !permissionGrantedForRequest) return;
    setStatus('loading');
    setHistoryError('');
    try {
      const range = searchPeriod === 'All'
        ? { startTime: 0, endTime: Date.now() }
        : getHistoryRange(searchPeriod as HistoryPeriod);

      const items = await chrome.history.search({
        text: searchQuery,
        startTime: range.startTime,
        endTime: range.endTime,
        maxResults: 500,
      });

      const seen = new Set<string>();
      const historyResults: HistoryResult[] = [];
      for (const item of items) {
        if (!item.url || seen.has(item.url)) continue;
        if (!isUserPage(item.url)) continue;
        seen.add(item.url);
        const hostname = normalizeWebHost(item.url);
        if (!hostname) continue;
        historyResults.push({
          title: item.title || '',
          url: item.url,
          hostname,
          lastVisitTime: item.lastVisitTime ?? 0,
          visitCount: item.visitCount ?? 0,
          faviconUrl: faviconUrl(item.url),
        });
      }
      setResults(historyResults);
      setVisibleCount(PAGE_SIZE);
      setStatus('ready');

      // Save to recent searches
      if (searchQuery.trim()) {
        void addRecentSearch(searchQuery.trim()).then(setRecentSearches).catch(() => undefined);
      }
    } catch {
      setStatus('error');
      setHistoryError('Could not search browsing history. Check the extension permissions and try again.');
    }
  }, [status]);

  const handleSubmit = useCallback(() => {
    setSubmittedQuery(query);
    void searchHistory(query, period);
    setShowRecent(false);
  }, [query, period, searchHistory]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      setShowRecent(false);
    }
  }, [handleSubmit]);

  // Debounced search on query change
  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (value.trim().length >= 2) {
        setSubmittedQuery(value);
        void searchHistory(value, period);
      }
    }, 400);
  }, [period, searchHistory]);

  const requestHistoryPermission = async () => {
    setRequestPending(true);
    try {
      const allowed = await chrome.permissions.request({ permissions: ['history'] });
      if (allowed) {
        setStatus('ready');
        if (query.trim()) {
          setSubmittedQuery(query);
          void searchHistory(query, period, true);
        }
      } else {
        setStatus('permission');
      }
    } catch {
      setHistoryError('Chrome did not grant history access. You can enable it in extension settings.');
      setStatus('error');
    } finally {
      setRequestPending(false);
    }
  };

  const handleReset = () => {
    setQuery('');
    setSubmittedQuery('');
    setPeriod('Last 30 days');
    setSortKey('relevance');
    setDomainFilter('');
    setResults([]);
    setVisibleCount(PAGE_SIZE);
  };

  const handleRecentSelect = (search: string) => {
    setQuery(search);
    setShowRecent(false);
    setSubmittedQuery(search);
    void searchHistory(search, period);
  };

  const handleClearRecent = () => {
    void clearRecentSearches().then(() => setRecentSearches([])).catch(() => undefined);
  };

  // Ranking, filtering, sorting
  const savedUrls = useMemo(() => new Set(savedItems.map((i) => i.url)), [savedItems]);

  const processedResults = useMemo(() => {
    let items = results;

    // Domain filter
    if (domainFilter) {
      items = items.filter((i) => i.hostname === domainFilter);
    }

    // Rank by query
    if (submittedQuery.trim()) {
      const ranked = rankItems(items, submittedQuery, now);
      items = ranked.map((r) => r.item as HistoryResult);
    }

    // Sort
    if (sortKey === 'recent') {
      items = [...items].sort((a, b) => b.lastVisitTime - a.lastVisitTime);
    } else if (sortKey === 'visits') {
      items = [...items].sort((a, b) => b.visitCount - a.visitCount || b.lastVisitTime - a.lastVisitTime);
    }
    // 'relevance' keeps rank order

    return items;
  }, [results, domainFilter, submittedQuery, sortKey, now]);

  // Available domains for filter
  const availableDomains = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of results) {
      counts.set(r.hostname, (counts.get(r.hostname) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([host]) => host);
  }, [results]);

  const visibleResults = processedResults.slice(0, visibleCount);

  // Save / unsave
  const handleSave = async (item: HistoryResult) => {
    try {
      const updated = await saveRecallItem({ url: item.url, title: item.title });
      setSavedItems(updated);
    } catch { /* size limit */ }
  };

  const handleUnsave = async (url: string) => {
    try {
      const updated = await unsaveRecallByUrl(url);
      setSavedItems(updated);
    } catch { /* ignore */ }
  };

  const handleDeleteSaved = async (id: string) => {
    if (!window.confirm('Remove this saved item from your Recall collection?')) return;
    try {
      const updated = await deleteRecallItem(id);
      setSavedItems(updated);
    } catch { /* ignore */ }
  };

  const handleOpenUrl = (url: string) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        void chrome.tabs.create({ url: u.href });
      }
    } catch { /* invalid URL */ }
  };

  // Edit note/tags
  const startEdit = (item: RecallItem) => {
    setEditingId(item.id);
    setEditNote(item.note ?? '');
    setEditTags(item.tags ?? '');
  };

  const saveEdit = async () => {
    if (!editingId) return;
    try {
      const updated = await updateRecallItem(editingId, { note: editNote, tags: editTags });
      setSavedItems(updated);
      setEditingId(null);
    } catch { /* ignore */ }
  };

  // Filtered saved items
  const filteredSaved = useMemo(() => searchRecallItems(savedItems, savedQuery), [savedItems, savedQuery]);

  // Period change triggers new search
  useEffect(() => {
    if (submittedQuery.trim() && status === 'ready') {
      void searchHistory(submittedQuery, period);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  return (
    <div className="recall-view">
      <div className="recall-notice">
        <span className="recall-notice-icon">
          <Search size={15} aria-hidden="true" />
        </span>
        <p>
          <strong>Private local history search</strong>
          <span>
            Web Recall searches page titles and URLs from your Chrome history locally. It does not search page
            contents, transmit queries, or modify browsing history.
          </span>
        </p>
        <span className="sample-label">LOCAL ONLY</span>
      </div>

      {/* Tabs */}
      <div className="recall-tabs" role="tablist" aria-label="Recall views">
        <button
          className={`recall-tab${tab === 'search' ? ' recall-tab-active' : ''}`}
          role="tab"
          aria-selected={tab === 'search'}
          onClick={() => setTab('search')}
        >
          <Search size={12} style={{ marginRight: 4, verticalAlign: -1 }} aria-hidden="true" />
          Search History
        </button>
        <button
          className={`recall-tab${tab === 'saved' ? ' recall-tab-active' : ''}`}
          role="tab"
          aria-selected={tab === 'saved'}
          onClick={() => setTab('saved')}
        >
          <Bookmark size={12} style={{ marginRight: 4, verticalAlign: -1 }} aria-hidden="true" />
          Saved ({savedItems.length})
        </button>
      </div>

      {tab === 'search' && (
        <>
          {/* Search bar */}
          <div className="recall-search-bar">
            <div className="recall-search-wrap" ref={dropdownRef}>
              <Search size={15} aria-hidden="true" />
              <input
                ref={searchRef}
                className="recall-search-input"
                type="search"
                id="recall-search-input"
                placeholder="Search page titles and URLs…"
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => { if (recentSearches.length > 0 && !query) setShowRecent(true); }}
                aria-label="Search browsing history"
              />
              {query && (
                <button
                  className="recall-search-clear"
                  onClick={() => { setQuery(''); searchRef.current?.focus(); }}
                  aria-label="Clear search"
                >
                  <X size={14} />
                </button>
              )}
              {showRecent && recentSearches.length > 0 && (
                <div className="recall-recent-searches" role="listbox" aria-label="Recent searches">
                  <div className="recall-recent-header">
                    <span>RECENT SEARCHES</span>
                    <button className="recall-recent-clear" onClick={handleClearRecent}>
                      Clear
                    </button>
                  </div>
                  {recentSearches.map((s) => (
                    <button
                      className="recall-recent-item"
                      key={s}
                      role="option"
                      onClick={() => handleRecentSelect(s)}
                    >
                      <RotateCcw size={12} aria-hidden="true" />
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              className="primary-button"
              onClick={handleSubmit}
              disabled={status === 'loading' || status === 'permission'}
            >
              Search
            </button>
          </div>

          {/* Filters */}
          <div className="recall-filters">
            <div className="recall-filter-group">
              <span className="recall-filter-label">
                <Calendar size={11} style={{ verticalAlign: -1, marginRight: 2 }} aria-hidden="true" />
                Range
              </span>
              <select
                className="recall-filter-select"
                value={period}
                onChange={(e) => setPeriod(e.target.value as RecallPeriod)}
                aria-label="Date range"
              >
                {PERIODS.map((p) => <option key={p} value={p}>{p === 'All' ? 'All history' : p}</option>)}
              </select>
            </div>

            {availableDomains.length > 1 && (
              <div className="recall-filter-group">
                <span className="recall-filter-label">Domain</span>
                <select
                  className="recall-filter-select"
                  value={domainFilter}
                  onChange={(e) => setDomainFilter(e.target.value)}
                  aria-label="Filter by domain"
                >
                  <option value="">All domains</option>
                  {availableDomains.slice(0, 50).map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            )}

            <div className="recall-filters-right">
              <div className="recall-filter-group">
                <span className="recall-filter-label">Sort</span>
                <select
                  className="recall-filter-select"
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as RecallSort)}
                  aria-label="Sort results"
                >
                  <option value="relevance">Most relevant</option>
                  <option value="recent">Most recent</option>
                  <option value="visits">Most visited</option>
                </select>
              </div>
              {(query || domainFilter || period !== 'Last 30 days' || sortKey !== 'relevance') && (
                <button className="recall-reset-btn" onClick={handleReset} aria-label="Reset all filters">
                  <RotateCcw size={10} style={{ marginRight: 3, verticalAlign: -1 }} aria-hidden="true" />
                  Reset
                </button>
              )}
            </div>
          </div>

          {/* Permission state */}
          {status === 'permission' && (
            <section className="access-panel">
              <div>
                <strong>Allow access to browsing history</strong>
                <p>
                  Web Recall uses Chrome's History API to search page titles and URLs from your local browsing history.
                  Results are processed locally and are not sent anywhere.
                </p>
              </div>
              <button className="primary-button" onClick={() => void requestHistoryPermission()} disabled={requestPending}>
                {requestPending ? 'Requesting…' : 'Allow history access'}
              </button>
            </section>
          )}

          {/* Loading */}
          {status === 'loading' && (
            <p className="state-message" role="status">
              Searching local browsing history…
            </p>
          )}

          {/* Error */}
          {status === 'error' && (
            <div className="state-message state-error" role="alert">
              <span>{historyError || 'Could not access browsing history.'}</span>
              <button className="secondary-button" onClick={handleSubmit}>
                Try again
              </button>
            </div>
          )}

          {/* Results */}
          {status === 'ready' && submittedQuery.trim() && (
            <>
              <div className="recall-results-header">
                <span className="recall-result-count">
                  <strong>{processedResults.length}</strong>{' '}
                  {processedResults.length === 1 ? 'result' : 'results'}
                  {domainFilter ? ` on ${domainFilter}` : ''}
                  {results.length === 500 ? ' · Showing up to 500 matching pages' : ''}
                </span>
              </div>

              {processedResults.length === 0 ? (
                <div className="recall-empty">
                  <div className="recall-empty-icon">
                    <Search size={18} aria-hidden="true" />
                  </div>
                  <strong>No results found</strong>
                  <p>
                    No pages matching "{submittedQuery}" were found in your local history{domainFilter ? ` on ${domainFilter}` : ''} for the selected period.
                    Only page titles and URLs are searched, not page content.
                  </p>
                </div>
              ) : (
                <div className="recall-results">
                  {visibleResults.map((item) => (
                    <ResultRow
                      key={item.url}
                      item={item}
                      now={now}
                      isSaved={savedUrls.has(item.url)}
                      onSave={() => void handleSave(item)}
                      onUnsave={() => void handleUnsave(item.url)}
                      onOpen={() => handleOpenUrl(item.url)}
                    />
                  ))}
                  {visibleCount < processedResults.length && (
                    <div className="recall-load-more">
                      <button
                        className="secondary-button"
                        onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                      >
                        Show more ({processedResults.length - visibleCount} remaining)
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Initial state before first search */}
          {status === 'ready' && !submittedQuery.trim() && results.length === 0 && (
            <div className="recall-empty">
              <div className="recall-empty-icon">
                <Search size={18} aria-hidden="true" />
              </div>
              <strong>Search your browsing history</strong>
              <p>
                Type keywords to search through page titles and URLs from your local Chrome history.
                Results are ranked by relevance, recency, and visit frequency.
              </p>
            </div>
          )}
        </>
      )}

      {tab === 'saved' && (
        <>
          {/* Saved items search */}
          <div className="recall-search-bar">
            <div className="recall-search-wrap">
              <Search size={15} aria-hidden="true" />
              <input
                className="recall-search-input"
                type="search"
                id="recall-saved-search"
                placeholder="Search saved items…"
                value={savedQuery}
                onChange={(e) => setSavedQuery(e.target.value)}
                aria-label="Search saved Recall items"
              />
              {savedQuery && (
                <button
                  className="recall-search-clear"
                  onClick={() => setSavedQuery('')}
                  aria-label="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {savedItems.length === 0 ? (
            <div className="recall-empty">
              <div className="recall-empty-icon">
                <Bookmark size={18} aria-hidden="true" />
              </div>
              <strong>No saved items yet</strong>
              <p>
                Save history search results to your Recall collection for easier future retrieval.
                Saved items stay local on this device.
              </p>
            </div>
          ) : filteredSaved.length === 0 ? (
            <div className="recall-empty">
              <div className="recall-empty-icon">
                <Search size={18} aria-hidden="true" />
              </div>
              <strong>No matching saved items</strong>
              <p>No saved items match "{savedQuery}".</p>
            </div>
          ) : (
            <>
              <div className="recall-results-header">
                <span className="recall-result-count">
                  <strong>{filteredSaved.length}</strong> saved{' '}
                  {filteredSaved.length === 1 ? 'item' : 'items'}
                  {savedQuery ? ` matching "${savedQuery}"` : ''}
                </span>
              </div>
              <div className="recall-results">
                {filteredSaved.map((item) => (
                  <SavedItemRow
                    key={item.id}
                    item={item}
                    now={now}
                    isEditing={editingId === item.id}
                    editNote={editNote}
                    editTags={editTags}
                    onEditNote={setEditNote}
                    onEditTags={setEditTags}
                    onStartEdit={() => startEdit(item)}
                    onSaveEdit={() => void saveEdit()}
                    onCancelEdit={() => setEditingId(null)}
                    onDelete={() => void handleDeleteSaved(item.id)}
                    onOpen={() => handleOpenUrl(item.url)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ── Result row (search tab) ────────────────────────────────────── */

function ResultRow({
  item,
  now,
  isSaved,
  onSave,
  onUnsave,
  onOpen,
}: {
  item: HistoryResult;
  now: number;
  isSaved: boolean;
  onSave: () => void;
  onUnsave: () => void;
  onOpen: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const displayTitle = item.title || item.hostname;
  return (
    <div className="recall-result-item">
      <span className="recall-result-favicon">
        {item.faviconUrl && !imgError ? (
          <img src={item.faviconUrl} alt="" onError={() => setImgError(true)} />
        ) : (
          <span className="recall-result-favicon-fallback">{item.hostname.charAt(0)}</span>
        )}
      </span>
      <div className="recall-result-body">
        <span className="recall-result-title">
          {displayTitle}
          {isSaved && (
            <span className="recall-saved-badge">
              <BookmarkCheck size={9} aria-hidden="true" /> Saved
            </span>
          )}
        </span>
        <span className="recall-result-url">{item.hostname}{new URL(item.url).pathname !== '/' ? new URL(item.url).pathname : ''}</span>
        <span className="recall-result-meta">
          {item.lastVisitTime > 0 && (
            <span title={formatDateTime(item.lastVisitTime)}>
              <Clock3 size={10} aria-hidden="true" />
              {formatRelativeTime(item.lastVisitTime, now)}
            </span>
          )}
          {item.visitCount > 0 && (
            <span>
              <Hash size={10} aria-hidden="true" />
              {item.visitCount} {item.visitCount === 1 ? 'visit' : 'visits'}
            </span>
          )}
        </span>
      </div>
      <div className="recall-result-actions">
        <button
          className={`recall-action-btn${isSaved ? ' recall-action-btn-saved' : ''}`}
          onClick={isSaved ? onUnsave : onSave}
          title={isSaved ? 'Remove from Recall' : 'Save to Recall'}
          aria-label={isSaved ? 'Unsave this page' : 'Save this page'}
        >
          {isSaved ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
        </button>
        <button
          className="recall-action-btn"
          onClick={onOpen}
          title="Open in new tab"
          aria-label="Open page in new tab"
        >
          <ExternalLink size={14} />
        </button>
      </div>
    </div>
  );
}

/* ── Saved-item row (saved tab) ─────────────────────────────────── */

function SavedItemRow({
  item,
  now,
  isEditing,
  editNote,
  editTags,
  onEditNote,
  onEditTags,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  onOpen,
}: {
  item: RecallItem;
  now: number;
  isEditing: boolean;
  editNote: string;
  editTags: string;
  onEditNote: (v: string) => void;
  onEditTags: (v: string) => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="recall-result-item">
      <span className="recall-result-favicon">
        <span className="recall-result-favicon-fallback">{item.hostname.charAt(0)}</span>
      </span>
      <div className="recall-result-body">
        <span className="recall-result-title">{item.title || item.hostname}</span>
        <span className="recall-result-url">{item.hostname}</span>
        <span className="recall-result-meta">
          <span title={formatDateTime(item.savedAt)}>
            <Bookmark size={10} aria-hidden="true" />
            Saved {formatRelativeTime(item.savedAt, now)}
          </span>
        </span>
        {item.note && !isEditing && (
          <div className="recall-saved-note">
            <StickyNote size={11} aria-hidden="true" />
            <span>{item.note}</span>
          </div>
        )}
        {item.tags && !isEditing && (
          <div className="recall-saved-tags">
            {item.tags.split(',').map((t) => t.trim()).filter(Boolean).map((t) => (
              <span className="recall-tag" key={t}>
                <Tag size={8} aria-hidden="true" /> {t}
              </span>
            ))}
          </div>
        )}
        {isEditing && (
          <div className="recall-edit-form">
            <label>
              Note
              <textarea
                value={editNote}
                onChange={(e) => onEditNote(e.target.value)}
                placeholder="Add a personal note…"
                maxLength={1000}
              />
            </label>
            <label>
              Tags (comma-separated)
              <input
                value={editTags}
                onChange={(e) => onEditTags(e.target.value)}
                placeholder="e.g. research, work, reference"
                maxLength={500}
              />
            </label>
            <div className="recall-edit-actions">
              <button className="secondary-button" onClick={onCancelEdit}>Cancel</button>
              <button className="primary-button" onClick={onSaveEdit}>Save</button>
            </div>
          </div>
        )}
      </div>
      <div className="recall-result-actions">
        {!isEditing && (
          <button
            className="recall-action-btn"
            onClick={onStartEdit}
            title="Edit note and tags"
            aria-label="Edit note and tags"
          >
            <Pencil size={13} />
          </button>
        )}
        <button
          className="recall-action-btn"
          onClick={onOpen}
          title="Open in new tab"
          aria-label="Open page in new tab"
        >
          <ExternalLink size={14} />
        </button>
        <button
          className="recall-action-btn"
          onClick={onDelete}
          title="Delete saved item"
          aria-label="Delete saved item"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
