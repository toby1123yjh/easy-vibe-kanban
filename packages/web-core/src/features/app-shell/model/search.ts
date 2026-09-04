import type { ProjectListItem, SessionListItem } from 'shared/types';
import {
  deriveActiveShellModule,
  type AppShellCapabilityAdapter,
  type NavigableShellModule,
} from './appShell';

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

export interface SearchCopy {
  groups: Readonly<Record<SearchResultGroup, string>>;
  destinations: Readonly<
    Record<
      | 'dashboard'
      | 'projects'
      | 'workflows'
      | 'agents'
      | 'appearance'
      | 'agentTools',
      Readonly<{ title: string; path: string }>
    >
  >;
  projectPath: string;
  agentFallback: string;
  providerPath(provider: string): string;
  sessionPath(agent: string): string;
}

export const DEFAULT_SEARCH_COPY: SearchCopy = {
  groups: {
    agent: 'Agents',
    config: 'Configuration',
    tool: 'Tools',
    'feature-object': 'Features and objects',
  },
  destinations: {
    dashboard: { title: 'Dashboard', path: 'Features / Dashboard' },
    projects: { title: 'Projects', path: 'Features / Projects' },
    workflows: { title: 'Workflows', path: 'Features / Workflows' },
    agents: { title: 'Agents', path: 'Features / Agents' },
    appearance: { title: 'Appearance', path: 'Settings / Appearance' },
    agentTools: {
      title: 'Agent tools',
      path: 'Settings / MCP, skills and commands',
    },
  },
  projectPath: 'Projects',
  agentFallback: 'Agent',
  providerPath: (provider) => `Agents / ${provider}`,
  sessionPath: (agent) => `Sessions / ${agent}`,
};

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

function createStaticDestinations(
  copy: SearchCopy
): readonly SearchableDestination[] {
  return [
    {
      id: 'feature-dashboard',
      kind: 'feature',
      group: 'feature-object',
      ...copy.destinations.dashboard,
      route: '/dashboard',
      keywords: ['home', 'overview'],
    },
    {
      id: 'feature-projects',
      kind: 'feature',
      group: 'feature-object',
      ...copy.destinations.projects,
      route: '/projects',
      keywords: ['kanban', 'issues'],
    },
    {
      id: 'feature-workflows',
      kind: 'feature',
      group: 'feature-object',
      ...copy.destinations.workflows,
      route: '/workflows',
      keywords: ['nodes', 'automation'],
    },
    {
      id: 'feature-agents',
      kind: 'feature',
      group: 'feature-object',
      ...copy.destinations.agents,
      route: '/agents',
      keywords: ['providers', 'models'],
    },
    ...['Codex', 'Claude Code', 'Gemini', 'Oh My Pi'].map(
      (title): SearchableDestination => ({
        id: `provider-${title.toLowerCase().replaceAll(' ', '-')}`,
        kind: 'provider',
        group: 'agent',
        title,
        path: copy.providerPath(title),
        route: `/agents?provider=${encodeURIComponent(title)}`,
        keywords: ['agent', 'provider'],
      })
    ),
    {
      id: 'setting-appearance',
      kind: 'setting',
      group: 'config',
      ...copy.destinations.appearance,
      route: '/settings?tab=general&section=application',
      keywords: ['theme', 'light', 'dark'],
    },
    {
      id: 'setting-agent-tools',
      kind: 'setting',
      group: 'tool',
      ...copy.destinations.agentTools,
      route: '/agents',
      keywords: ['mcp', 'skills', 'commands'],
    },
  ];
}

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
  moduleCapabilities?: AppShellCapabilityAdapter['moduleCapabilities'];
  copy?: SearchCopy;
}): AppSearchResult[] {
  const copy = options.copy ?? DEFAULT_SEARCH_COPY;
  const projectDestinations: SearchableDestination[] = options.projects.map(
    (project) => ({
      id: `project-${project.id}`,
      kind: 'project',
      group: 'feature-object',
      title: project.name,
      path: copy.projectPath,
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
      path: copy.sessionPath(session.executor ?? copy.agentFallback),
      route: `/workspaces/${encodeURIComponent(session.workspace_id)}`,
      sourceState: options.sessionSourceState,
    })
  );
  const query = options.query.trim();
  return [
    ...createStaticDestinations(copy),
    ...projectDestinations,
    ...sessionDestinations,
  ]
    .filter((destination) =>
      options.moduleCapabilities
        ? isSearchRouteAvailable(destination.route, options.moduleCapabilities)
        : true
    )
    .filter((destination) => matches(destination, query))
    .slice(0, 50)
    .map((destination) => toResult(destination, query));
}

export function deriveSearchRouteModule(
  route: string
): NavigableShellModule | null {
  const pathname = route.split(/[?#]/, 1)[0] || '/';
  const activeModule = deriveActiveShellModule(pathname);
  if (activeModule && activeModule !== 'search') return activeModule;
  if (pathname.startsWith('/workspaces/')) return 'projects';
  return null;
}

export function isSearchRouteAvailable(
  route: string,
  capabilities: AppShellCapabilityAdapter['moduleCapabilities']
): boolean {
  const module = deriveSearchRouteModule(route);
  return module === null || capabilities[module].availability === 'available';
}

export function groupSearchResults(
  results: readonly AppSearchResult[],
  labels: Readonly<
    Record<SearchResultGroup, string>
  > = DEFAULT_SEARCH_COPY.groups
): AppSearchResultGroup[] {
  const order: readonly SearchResultGroup[] = [
    'agent',
    'config',
    'tool',
    'feature-object',
  ];
  return order
    .map((id) => ({
      id,
      label: labels[id],
      results: results.filter((result) => result.group === id),
    }))
    .filter((group) => group.results.length > 0);
}

export function deriveSearchSourceState(
  hasError: boolean,
  itemCount: number
): SearchSourceState {
  if (!hasError) return 'available';
  return itemCount > 0 ? 'partial' : 'unavailable';
}
