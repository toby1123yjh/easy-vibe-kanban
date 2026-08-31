import type { ProjectListItem, SessionListItem } from 'shared/types';

export type SearchResultKind =
  | 'feature'
  | 'setting'
  | 'provider'
  | 'mcp'
  | 'skill'
  | 'command'
  | 'project'
  | 'session'
  | 'issue'
  | 'workflow'
  | 'run';

export type SearchResultGroup = 'agent' | 'config' | 'tool' | 'feature-object';

export type SearchSourceState = 'available' | 'unavailable' | 'partial';

export const SEARCH_RESULT_GROUPS: readonly {
  id: SearchResultGroup;
  label: string;
}[] = [
  { id: 'agent', label: 'Agents' },
  { id: 'config', label: 'Configuration' },
  { id: 'tool', label: 'Tools' },
  { id: 'feature-object', label: 'Features and objects' },
];

export interface SearchHighlight {
  text: string;
  matched: boolean;
}

export interface AppSearchResult {
  id: string;
  kind: SearchResultKind;
  group: SearchResultGroup;
  title: string;
  path: string;
  status?: string;
  route: string;
  highlights: SearchHighlight[];
  sourceState: SearchSourceState;
}

export interface AppSearchResultGroup {
  id: SearchResultGroup;
  label: string;
  results: AppSearchResult[];
}

interface SearchableDestination
  extends Omit<AppSearchResult, 'highlights' | 'sourceState'> {
  keywords?: readonly string[];
  sourceState?: SearchSourceState;
}

const STATIC_DESTINATIONS: readonly SearchableDestination[] = [
  {
    id: 'feature-dashboard',
    kind: 'feature',
    group: 'feature-object',
    title: 'Dashboard',
    path: 'Features / Dashboard',
    route: '/dashboard',
    keywords: ['home', 'overview'],
  },
  {
    id: 'feature-projects',
    kind: 'feature',
    group: 'feature-object',
    title: 'Projects',
    path: 'Features / Projects',
    route: '/projects',
    keywords: ['kanban', 'issues'],
  },
  {
    id: 'feature-workflows',
    kind: 'feature',
    group: 'feature-object',
    title: 'Workflows',
    path: 'Features / Workflows',
    route: '/workflows',
    keywords: ['nodes', 'automation'],
  },
  {
    id: 'feature-agents',
    kind: 'feature',
    group: 'feature-object',
    title: 'Agents',
    path: 'Features / Agents',
    route: '/agents',
    keywords: ['providers', 'models'],
  },
  ...['Codex', 'Claude Code', 'Gemini', 'Oh My Pi'].map(
    (title): SearchableDestination => ({
      id: `provider-${title.toLowerCase().replaceAll(' ', '-')}`,
      kind: 'provider',
      group: 'agent',
      title,
      path: `Agents / ${title}`,
      route: `/agents?provider=${encodeURIComponent(title)}`,
      keywords: ['agent', 'provider'],
    })
  ),
  {
    id: 'setting-appearance',
    kind: 'setting',
    group: 'config',
    title: 'Appearance',
    path: 'Settings / Appearance',
    route: '/settings?tab=general&section=application',
    keywords: ['theme', 'light', 'dark'],
  },
  {
    id: 'setting-agent-tools',
    kind: 'setting',
    group: 'tool',
    title: 'Agent tools',
    path: 'Settings / MCP, skills and commands',
    route: '/agents',
    keywords: ['mcp', 'skills', 'commands'],
  },
];

function highlightTitle(title: string, query: string): SearchHighlight[] {
  if (!query) return [{ text: title, matched: false }];
  const start = title.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (start === -1) return [{ text: title, matched: false }];
  const end = start + query.length;
  return [
    ...(start > 0 ? [{ text: title.slice(0, start), matched: false }] : []),
    { text: title.slice(start, end), matched: true },
    ...(end < title.length ? [{ text: title.slice(end), matched: false }] : []),
  ];
}

function matches(destination: SearchableDestination, query: string): boolean {
  if (!query) return true;
  const haystack = [
    destination.title,
    destination.path,
    destination.kind,
    ...(destination.keywords ?? []),
  ]
    .join(' ')
    .toLocaleLowerCase();
  return query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .every((part) => haystack.includes(part));
}

function toResult(
  destination: SearchableDestination,
  query: string
): AppSearchResult {
  return {
    id: destination.id,
    kind: destination.kind,
    group: destination.group,
    title: destination.title,
    path: destination.path,
    status: destination.status,
    route: destination.route,
    highlights: highlightTitle(destination.title, query),
    sourceState: destination.sourceState ?? 'available',
  };
}

export function buildSearchResults(options: {
  query: string;
  projects: readonly ProjectListItem[];
  sessions: readonly SessionListItem[];
  projectSourceState?: SearchSourceState;
  sessionSourceState?: SearchSourceState;
}): AppSearchResult[] {
  const projectDestinations: SearchableDestination[] = options.projects.map(
    (project) => ({
      id: `project-${project.id}`,
      kind: 'project',
      group: 'feature-object',
      title: project.name,
      path: 'Projects',
      route: `/projects/${encodeURIComponent(project.id)}`,
      sourceState: options.projectSourceState,
    })
  );
  const sessionDestinations: SearchableDestination[] = options.sessions.map(
    (session) => ({
      id: `session-${session.id}`,
      kind: 'session',
      group: 'feature-object',
      title: session.title,
      path: `Sessions / ${session.executor ?? 'Agent'}`,
      route: `/workspaces/${encodeURIComponent(session.workspace_id)}`,
      sourceState: options.sessionSourceState,
    })
  );
  const query = options.query.trim();
  return [
    ...STATIC_DESTINATIONS,
    ...projectDestinations,
    ...sessionDestinations,
  ]
    .filter((destination) => matches(destination, query))
    .slice(0, 50)
    .map((destination) => toResult(destination, query));
}

export function groupSearchResults(
  results: readonly AppSearchResult[]
): AppSearchResultGroup[] {
  return SEARCH_RESULT_GROUPS.map((group) => ({
    ...group,
    results: results.filter((result) => result.group === group.id),
  })).filter((group) => group.results.length > 0);
}

export function deriveSearchSourceState(
  hasError: boolean,
  itemCount: number
): SearchSourceState {
  if (!hasError) return 'available';
  return itemCount > 0 ? 'partial' : 'unavailable';
}
