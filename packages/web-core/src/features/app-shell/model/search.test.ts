import { expect, test } from '@playwright/test';
import {
  buildSearchResults,
  deriveSearchRouteModule,
  deriveSearchSourceState,
  groupSearchResults,
  isSearchRouteAvailable,
} from './search';
import type { AppShellCapabilityAdapter } from './appShell';

const MODULE_CAPABILITIES = {
  dashboard: { availability: 'available', navigate: () => undefined },
  projects: { availability: 'available', navigate: () => undefined },
  workflows: {
    availability: 'unavailable',
    reason: 'Workflow service is unavailable.',
  },
  agents: { availability: 'available', navigate: () => undefined },
} satisfies AppShellCapabilityAdapter['moduleCapabilities'];

test.describe('Global Search projection', () => {
  test('normalizes static and canonical object destinations', () => {
    const results = buildSearchResults({
      query: 'alpha',
      projects: [
        {
          id: 'p-1',
          name: 'Alpha',
          created_at: '2026-08-29T00:00:00Z',
          updated_at: '2026-08-29T00:00:00Z',
        },
      ],
      sessions: [],
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: 'project-p-1',
      kind: 'project',
      route: '/projects/p-1',
      sourceState: 'available',
    });
    expect(results[0].highlights.some((part) => part.matched)).toBe(true);
  });

  test('shows useful suggestions while the query is empty', () => {
    const results = buildSearchResults({
      query: '',
      projects: [],
      sessions: [],
    });
    expect(results.some((result) => result.title === 'Codex')).toBe(true);
    expect(
      results.find((result) => result.title === 'Appearance')
    ).toMatchObject({
      route: '/settings?tab=general&section=application',
    });
  });

  test('groups results in the approved presentation order', () => {
    const groups = groupSearchResults(
      buildSearchResults({ query: '', projects: [], sessions: [] })
    );
    expect(groups.map((group) => group.id)).toEqual([
      'agent',
      'config',
      'tool',
      'feature-object',
    ]);
  });

  test('preserves partial and unavailable source state', () => {
    expect(deriveSearchSourceState(true, 1)).toBe('partial');
    expect(deriveSearchSourceState(true, 0)).toBe('unavailable');
    expect(deriveSearchSourceState(false, 0)).toBe('available');

    const [project] = buildSearchResults({
      query: 'alpha',
      projects: [
        {
          id: 'p-1',
          name: 'Alpha',
          created_at: '2026-08-29T00:00:00Z',
          updated_at: '2026-08-29T00:00:00Z',
        },
      ],
      sessions: [],
      projectSourceState: 'partial',
    });
    expect(project.sourceState).toBe('partial');
  });

  test('maps result routes to shell capabilities and omits unavailable modules', () => {
    expect(deriveSearchRouteModule('/projects/p-1')).toBe('projects');
    expect(deriveSearchRouteModule('/workspaces/w-1')).toBe('projects');
    expect(deriveSearchRouteModule('/workflows?template=t-1')).toBe(
      'workflows'
    );
    expect(deriveSearchRouteModule('/settings?tab=general')).toBeNull();
    expect(isSearchRouteAvailable('/workflows', MODULE_CAPABILITIES)).toBe(
      false
    );
    expect(isSearchRouteAvailable('/agents', MODULE_CAPABILITIES)).toBe(true);

    const results = buildSearchResults({
      query: '',
      projects: [],
      sessions: [],
      moduleCapabilities: MODULE_CAPABILITIES,
    });
    expect(results.some((result) => result.route === '/workflows')).toBe(false);
    expect(results.some((result) => result.route === '/agents')).toBe(true);
  });

  test('maps scoped object routes before capability revalidation', () => {
    expect(deriveSearchRouteModule('/workspaces/w-1?tab=chat')).toBe(
      'projects'
    );
    expect(isSearchRouteAvailable('/workspaces/w-1', MODULE_CAPABILITIES)).toBe(
      true
    );
  });
});
