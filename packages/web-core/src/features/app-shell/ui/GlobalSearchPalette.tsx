import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowRight, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ProjectListItem, SessionListItem } from 'shared/types';
import { DegradedState, ErrorState } from '@vibe/ui/components/StateSurface';
import type { AppShellCapabilityAdapter } from '../model/appShell';
import {
  buildSearchResults,
  groupSearchResults,
  type SearchCopy,
  type SearchSourceState,
} from '../model/search';

export interface SearchSourceSummary {
  id: 'projects' | 'sessions';
  state: SearchSourceState;
  retry(): void;
}

interface GlobalSearchPaletteProps {
  open: boolean;
  scopeKey: string;
  projects: readonly ProjectListItem[];
  sessions: readonly SessionListItem[];
  sources: readonly SearchSourceSummary[];
  moduleCapabilities: AppShellCapabilityAdapter['moduleCapabilities'];
  onClose(options?: { restoreFocus?: boolean }): void;
  onNavigate(route: string): boolean;
}

function SearchSourceNotice({ source }: { source: SearchSourceSummary }) {
  const { t } = useTranslation('common');
  const label = t(`appShell.objects.${source.id}`);
  const action = (
    <button type="button" className="vk-state-retry" onClick={source.retry}>
      {t('appShell.objects.retry')}
    </button>
  );

  if (source.state === 'partial') {
    return (
      <DegradedState
        compact
        className="vk-search-source-state"
        title={t('appShell.search.sourcePartial', { label })}
        description={t('appShell.search.cachedResults')}
        action={action}
        role="status"
        aria-live="polite"
      />
    );
  }

  return (
    <ErrorState
      compact
      className="vk-search-source-state"
      title={t('appShell.search.sourceUnavailable', { label })}
      description={t('appShell.search.otherSourcesAvailable')}
      action={action}
    />
  );
}

export function GlobalSearchPalette({
  open,
  scopeKey,
  projects,
  sessions,
  sources,
  moduleCapabilities,
  onClose,
  onNavigate,
}: GlobalSearchPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();
  const { t, i18n } = useTranslation('common');

  const searchCopy = useMemo<SearchCopy>(
    () => ({
      groups: {
        agent: t('appShell.search.groups.agents'),
        config: t('appShell.search.groups.configuration'),
        tool: t('appShell.search.groups.tools'),
        'feature-object': t('appShell.search.groups.featuresAndObjects'),
      },
      destinations: {
        dashboard: {
          title: t('appShell.modules.dashboard'),
          path: t('appShell.search.paths.features', {
            name: t('appShell.modules.dashboard'),
          }),
        },
        projects: {
          title: t('appShell.modules.projects'),
          path: t('appShell.search.paths.features', {
            name: t('appShell.modules.projects'),
          }),
        },
        workflows: {
          title: t('appShell.modules.workflows'),
          path: t('appShell.search.paths.features', {
            name: t('appShell.modules.workflows'),
          }),
        },
        agents: {
          title: t('appShell.modules.agents'),
          path: t('appShell.search.paths.features', {
            name: t('appShell.modules.agents'),
          }),
        },
        appearance: {
          title: t('appShell.search.destinations.appearance'),
          path: t('appShell.search.paths.settings', {
            name: t('appShell.search.destinations.appearance'),
          }),
        },
        agentTools: {
          title: t('appShell.search.destinations.agentTools'),
          path: t('appShell.search.paths.settings', {
            name: t('appShell.search.destinations.agentToolTypes'),
          }),
        },
      },
      projectPath: t('appShell.objects.projects'),
      agentFallback: t('appShell.objects.agent'),
      providerPath: (provider) =>
        t('appShell.search.paths.agents', { name: provider }),
      sessionPath: (agent) =>
        t('appShell.search.paths.sessions', { name: agent }),
    }),
    [i18n.resolvedLanguage, t]
  );

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
    setQuery('');
    setDebouncedQuery('');
    setActiveIndex(0);
  }, [scopeKey]);

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
    if (!open) return;
    const timer = window.setTimeout(() => setDebouncedQuery(query), 180);
    return () => window.clearTimeout(timer);
  }, [open, query]);

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
        moduleCapabilities,
        copy: searchCopy,
      }),
    [
      debouncedQuery,
      moduleCapabilities,
      projects,
      searchCopy,
      sessions,
      sources,
    ]
  );
  const matchedResults = useMemo(
    () => (queryPending ? [] : results),
    [queryPending, results]
  );
  const groupedResults = useMemo(
    () => groupSearchResults(matchedResults, searchCopy.groups),
    [matchedResults, searchCopy.groups]
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
    if (!onNavigate(result.route)) return;
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
        aria-label={t('appShell.search.dialogLabel')}
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
            placeholder={t('appShell.search.placeholder')}
            autoComplete="off"
          />
          <button
            type="button"
            onClick={() => onClose()}
            aria-label={t('appShell.search.close')}
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        <div className="vk-search-palette__hint">
          {query === ''
            ? t('appShell.search.suggested')
            : t('appShell.search.results')}
          <span>{t('appShell.search.shortcutHint')}</span>
        </div>

        {sourceIssues.length > 0 && (
          <div className="vk-search-source-states">
            {sourceIssues.map((source) => (
              <SearchSourceNotice key={source.id} source={source} />
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
              {t('appShell.search.updating')}
            </p>
          ) : orderedResults.length === 0 ? (
            <p className="vk-search-results__empty">
              {t('appShell.search.noMatches')}
            </p>
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
                        {t(`appShell.search.kinds.${result.kind}`)}
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
