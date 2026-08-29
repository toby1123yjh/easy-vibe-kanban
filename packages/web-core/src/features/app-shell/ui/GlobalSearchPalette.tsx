import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowRight, Search, X } from 'lucide-react';
import type { ProjectListItem, SessionListItem } from 'shared/types';
import {
  buildSearchResults,
  groupSearchResults,
  type SearchSourceState,
} from '../model/search';

export interface SearchSourceSummary {
  id: 'projects' | 'sessions';
  label: string;
  state: SearchSourceState;
  retry(): void;
}

interface GlobalSearchPaletteProps {
  open: boolean;
  projects: readonly ProjectListItem[];
  sessions: readonly SessionListItem[];
  sources: readonly SearchSourceSummary[];
  onClose(options?: { restoreFocus?: boolean }): void;
  onNavigate(route: string): void;
}

export function GlobalSearchPalette({
  open,
  projects,
  sessions,
  sources,
  onClose,
  onNavigate,
}: GlobalSearchPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();

  useEffect(() => {
    if (!open) {
      setQuery('');
      setDebouncedQuery('');
      setActiveIndex(0);
      return;
    }
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'input, button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleDialogKeys, { capture: true });
    return () =>
      window.removeEventListener('keydown', handleDialogKeys, {
        capture: true,
      });
  }, [onClose, open]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  const queryPending = query !== debouncedQuery;
  const results = useMemo(
    () =>
      buildSearchResults({
        query: debouncedQuery,
        projects,
        sessions,
        projectSourceState: sources.find((source) => source.id === 'projects')
          ?.state,
        sessionSourceState: sources.find((source) => source.id === 'sessions')
          ?.state,
      }),
    [debouncedQuery, projects, sessions, sources]
  );
  const matchedResults = useMemo(
    () => (queryPending ? [] : results),
    [queryPending, results]
  );
  const groupedResults = useMemo(
    () => groupSearchResults(matchedResults),
    [matchedResults]
  );
  const orderedResults = useMemo(
    () => groupedResults.flatMap((group) => group.results),
    [groupedResults]
  );
  const sourceIssues = sources.filter((source) => source.state !== 'available');

  useEffect(() => setActiveIndex(0), [debouncedQuery, query]);

  useEffect(() => {
    setActiveIndex((index) =>
      orderedResults.length === 0
        ? 0
        : Math.min(index, orderedResults.length - 1)
    );
  }, [orderedResults.length]);

  if (!open) return null;

  const selectResult = (index: number) => {
    const result = orderedResults[index];
    if (!result) return;
    onNavigate(result.route);
    onClose({ restoreFocus: false });
  };

  return (
    <div
      className="vk-search-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="vk-search-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Global search"
      >
        <div className="vk-search-palette__input-row">
          <Search aria-hidden="true" size={18} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              switch (event.key) {
                case 'ArrowDown':
                  event.preventDefault();
                  setActiveIndex((index) =>
                    orderedResults.length === 0
                      ? 0
                      : (index + 1) % orderedResults.length
                  );
                  break;
                case 'ArrowUp':
                  event.preventDefault();
                  setActiveIndex((index) =>
                    orderedResults.length === 0
                      ? 0
                      : (index - 1 + orderedResults.length) %
                        orderedResults.length
                  );
                  break;
                case 'Enter':
                  event.preventDefault();
                  selectResult(activeIndex);
                  break;
              }
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={
              orderedResults[activeIndex]
                ? `${listId}-${orderedResults[activeIndex].id}`
                : undefined
            }
            placeholder="Search features, settings, agents and objects"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => onClose()}
            aria-label="Close search"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        <div className="vk-search-palette__hint">
          {query === '' ? 'Suggested destinations' : 'Search results'}
          <span>↑↓ navigate · Enter open · Esc close</span>
        </div>

        {sourceIssues.length > 0 && (
          <div className="vk-search-source-states" role="status">
            {sourceIssues.map((source) => (
              <div key={source.id}>
                <span>
                  {source.label}{' '}
                  {source.state === 'partial'
                    ? 'results may be incomplete.'
                    : 'results are unavailable.'}
                </span>
                <button type="button" onClick={source.retry}>
                  Retry
                </button>
              </div>
            ))}
          </div>
        )}

        <div
          id={listId}
          className="vk-search-results"
          role="listbox"
          aria-busy={queryPending}
        >
          {queryPending ? (
            <p className="vk-search-results__empty" role="status">
              Updating results…
            </p>
          ) : orderedResults.length === 0 ? (
            <p className="vk-search-results__empty">No matching destination</p>
          ) : (
            groupedResults.map((group) => (
              <section
                key={group.id}
                className="vk-search-result-group"
                role="group"
                aria-labelledby={`${listId}-${group.id}-label`}
              >
                <h2 id={`${listId}-${group.id}-label`}>{group.label}</h2>
                {group.results.map((result) => {
                  const index = orderedResults.indexOf(result);
                  return (
                    <button
                      type="button"
                      key={result.id}
                      id={`${listId}-${result.id}`}
                      role="option"
                      aria-selected={index === activeIndex}
                      className="vk-search-result"
                      data-active={index === activeIndex}
                      onMouseMove={() => setActiveIndex(index)}
                      onClick={() => selectResult(index)}
                    >
                      <span className="vk-search-result__copy">
                        <strong>
                          {result.highlights.map((part, partIndex) =>
                            part.matched ? (
                              <mark key={partIndex}>{part.text}</mark>
                            ) : (
                              <span key={partIndex}>{part.text}</span>
                            )
                          )}
                        </strong>
                        <small>{result.path}</small>
                      </span>
                      <span className="vk-search-result__kind">
                        {result.kind}
                      </span>
                      <ArrowRight aria-hidden="true" size={16} />
                    </button>
                  );
                })}
              </section>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
