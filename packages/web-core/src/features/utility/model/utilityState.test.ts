import { expect, test } from '@playwright/test';
import {
  projectEmbeddedWorkspaceState,
  projectExportSelectionState,
  projectUtilityCollectionState,
  reconcileExportProjectSelection,
} from './utilityState';

test.describe('Utility collection state projection', () => {
  test('keeps loading, successful empty, and initial error distinct', () => {
    expect(
      projectUtilityCollectionState({
        hasItems: false,
        isLoading: true,
        error: null,
      })
    ).toBe('loading');
    expect(
      projectUtilityCollectionState({
        hasItems: false,
        isLoading: false,
        error: null,
      })
    ).toBe('empty');
    expect(
      projectUtilityCollectionState({
        hasItems: false,
        isLoading: false,
        error: new Error('read failed'),
      })
    ).toBe('error');
  });

  test('keeps cached rows readable as degraded after refresh failure', () => {
    expect(
      projectUtilityCollectionState({
        hasItems: true,
        isLoading: false,
        error: new Error('refresh failed'),
      })
    ).toBe('degraded');
  });
});

test.describe('Export selection state projection', () => {
  const readyFacts = {
    organizationCount: 1,
    organizationsLoading: false,
    organizationsError: null,
    selectedOrganizationId: 'org-1',
    projectCount: 1,
    projectsLoading: false,
    projectsError: null,
  };

  test('does not turn an organization or project failure into Empty', () => {
    expect(
      projectExportSelectionState({
        ...readyFacts,
        organizationCount: 0,
        organizationsError: new Error('organizations failed'),
      })
    ).toBe('error');
    expect(
      projectExportSelectionState({
        ...readyFacts,
        projectCount: 0,
        projectsError: new Error('projects failed'),
      })
    ).toBe('error');
  });

  test('uses Empty only for successful zero-result reads', () => {
    expect(
      projectExportSelectionState({
        ...readyFacts,
        organizationCount: 0,
        selectedOrganizationId: null,
        projectCount: 0,
      })
    ).toBe('empty');
    expect(
      projectExportSelectionState({
        ...readyFacts,
        projectCount: 0,
      })
    ).toBe('empty');
  });

  test('preserves cached selections as Degraded', () => {
    expect(
      projectExportSelectionState({
        ...readyFacts,
        projectsError: new Error('project refresh failed'),
      })
    ).toBe('degraded');
    expect(
      projectExportSelectionState({
        ...readyFacts,
        organizationsError: new Error('organization refresh failed'),
      })
    ).toBe('degraded');
  });

  test('keeps project choices owner-scoped across refreshes', () => {
    const organizationOne = reconcileExportProjectSelection(null, 'org-1', [
      'project-1',
      'project-2',
    ]);
    expect(organizationOne).toEqual({
      organizationId: 'org-1',
      projectIds: ['project-1', 'project-2'],
    });

    const userChoice = {
      organizationId: 'org-1',
      projectIds: ['project-2'],
    };
    expect(
      reconcileExportProjectSelection(userChoice, 'org-1', [
        'project-2',
        'project-3',
      ])
    ).toEqual({ organizationId: 'org-1', projectIds: ['project-2'] });
    expect(
      reconcileExportProjectSelection(userChoice, 'org-2', ['project-9'])
    ).toEqual({ organizationId: 'org-2', projectIds: ['project-9'] });
  });
});

test.describe('Embedded workspace state projection', () => {
  const readyFacts = {
    hasWorkspace: true,
    workspaceLoading: false,
    workspaceError: null,
    sessionCount: 1,
    sessionsLoading: false,
    sessionsError: null,
    reposError: null,
  };

  test('terminates missing Workspace reads as Empty or Error', () => {
    expect(
      projectEmbeddedWorkspaceState({
        ...readyFacts,
        hasWorkspace: false,
        sessionCount: 0,
      })
    ).toBe('empty');
    expect(
      projectEmbeddedWorkspaceState({
        ...readyFacts,
        hasWorkspace: false,
        workspaceError: new Error('workspace failed'),
        sessionCount: 0,
      })
    ).toBe('error');
  });

  test('does not mistake a failed Session read for new-session mode', () => {
    expect(
      projectEmbeddedWorkspaceState({
        ...readyFacts,
        sessionCount: 0,
        sessionsError: new Error('sessions failed'),
      })
    ).toBe('error');
  });

  test('keeps cached Workspace content readable as Degraded', () => {
    expect(
      projectEmbeddedWorkspaceState({
        ...readyFacts,
        sessionsError: new Error('session refresh failed'),
      })
    ).toBe('degraded');
    expect(
      projectEmbeddedWorkspaceState({
        ...readyFacts,
        reposError: new Error('repositories failed'),
      })
    ).toBe('degraded');
  });

  test('allows a successfully empty Session list to start a new session', () => {
    expect(
      projectEmbeddedWorkspaceState({
        ...readyFacts,
        sessionCount: 0,
      })
    ).toBe('ready');
  });
});
