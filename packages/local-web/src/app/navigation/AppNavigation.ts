import { router } from '@web/app/router';
import type { FileRouteTypes } from '@web/routeTree.gen';
import {
  type AppDestination,
  type AppNavigation,
  type NavigationTransition,
  isProjectDestination,
} from '@/shared/lib/routes/appNavigation';

type LocalRouteId = FileRouteTypes['id'];

function getPathParam(
  routeParams: Record<string, string>,
  key: string
): string | null {
  const value = routeParams[key];
  return value ? value : null;
}

function parseLocalHostIdFromPathname(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean);
  const hostsIndex = segments.indexOf('hosts');
  if (hostsIndex === -1) {
    return null;
  }
  return segments[hostsIndex + 1] ?? null;
}

function resolveLocalDestinationFromPathUnscoped(
  path: string
): AppDestination | null {
  const { pathname } = new URL(path, 'http://localhost');
  const { foundRoute, routeParams } = router.getMatchedRoutes(pathname);

  if (!foundRoute) {
    return null;
  }

  switch (foundRoute.id as LocalRouteId) {
    case '/':
      return { kind: 'root' };
    case '/onboarding':
      return { kind: 'onboarding' };
    case '/onboarding_/sign-in':
      return { kind: 'onboarding-sign-in' };
    case '/_app/workspaces':
      return { kind: 'workspaces' };
    case '/_app/export':
      return { kind: 'export' };
    case '/_app/projects/':
      return { kind: 'project-directory' };
    case '/_app/workflows':
      return { kind: 'workflow-directory' };
    case '/_app/hosts/$hostId/workspaces': {
      const hostId = getPathParam(routeParams, 'hostId');
      return hostId ? { kind: 'workspaces', hostId } : null;
    }
    case '/_app/workspaces_/create':
      return { kind: 'workspaces-create' };
    case '/_app/hosts/$hostId/workspaces_/create': {
      const hostId = getPathParam(routeParams, 'hostId');
      return hostId ? { kind: 'workspaces-create', hostId } : null;
    }
    case '/_app/workspaces_/$workspaceId': {
      const workspaceId = getPathParam(routeParams, 'workspaceId');
      return workspaceId ? { kind: 'workspace', workspaceId } : null;
    }
    case '/_app/hosts/$hostId/workspaces_/$workspaceId': {
      const hostId = getPathParam(routeParams, 'hostId');
      const workspaceId = getPathParam(routeParams, 'workspaceId');
      return hostId && workspaceId
        ? { kind: 'workspace', hostId, workspaceId }
        : null;
    }
    case '/workspaces/$workspaceId/vscode': {
      const workspaceId = getPathParam(routeParams, 'workspaceId');
      return workspaceId ? { kind: 'workspace-vscode', workspaceId } : null;
    }
    case '/hosts/$hostId/workspaces/$workspaceId/vscode': {
      const hostId = getPathParam(routeParams, 'hostId');
      const workspaceId = getPathParam(routeParams, 'workspaceId');
      return hostId && workspaceId
        ? { kind: 'workspace-vscode', hostId, workspaceId }
        : null;
    }
    case '/_app/projects/$projectId': {
      const projectId = getPathParam(routeParams, 'projectId');
      return projectId ? { kind: 'project', projectId } : null;
    }
    case '/_app/projects/$projectId_/workflows': {
      const projectId = getPathParam(routeParams, 'projectId');
      return projectId ? { kind: 'project-workflows', projectId } : null;
    }
    case '/_app/projects/$projectId_/workflows_/$workflowId/edit': {
      const projectId = getPathParam(routeParams, 'projectId');
      const workflowId = getPathParam(routeParams, 'workflowId');
      return projectId && workflowId
        ? { kind: 'project-workflow-edit', projectId, workflowId }
        : null;
    }
    case '/_app/projects/$projectId_/workflow-runs/$runId': {
      const projectId = getPathParam(routeParams, 'projectId');
      const runId = getPathParam(routeParams, 'runId');
      return projectId && runId
        ? { kind: 'project-workflow-run', projectId, runId }
        : null;
    }
    case '/_app/projects/$projectId_/tasks/$taskId': {
      const projectId = getPathParam(routeParams, 'projectId');
      const taskId = getPathParam(routeParams, 'taskId');
      return projectId && taskId
        ? { kind: 'project-task', projectId, taskId }
        : null;
    }
    case '/_app/projects/$projectId_/tasks/$taskId_/arena/$groupId': {
      const projectId = getPathParam(routeParams, 'projectId');
      const taskId = getPathParam(routeParams, 'taskId');
      const arenaGroupId = getPathParam(routeParams, 'groupId');
      return projectId && taskId && arenaGroupId
        ? {
            kind: 'project-task-arena',
            projectId,
            taskId,
            arenaGroupId,
          }
        : null;
    }
    case '/_app/projects/$projectId_/tasks/$taskId_/workspaces/$workspaceId': {
      const projectId = getPathParam(routeParams, 'projectId');
      const taskId = getPathParam(routeParams, 'taskId');
      const workspaceId = getPathParam(routeParams, 'workspaceId');
      return projectId && taskId && workspaceId
        ? {
            kind: 'project-task-workspace',
            projectId,
            taskId,
            workspaceId,
          }
        : null;
    }
    case '/_app/projects/$projectId_/tasks/$taskId_/hosts/$hostId/workspaces/$workspaceId': {
      const projectId = getPathParam(routeParams, 'projectId');
      const taskId = getPathParam(routeParams, 'taskId');
      const hostId = getPathParam(routeParams, 'hostId');
      const workspaceId = getPathParam(routeParams, 'workspaceId');
      return projectId && taskId && hostId && workspaceId
        ? {
            kind: 'project-task-workspace',
            projectId,
            taskId,
            hostId,
            workspaceId,
          }
        : null;
    }
    case '/_app/projects/$projectId_/tasks/$taskId_/workspaces/create/$draftId': {
      const projectId = getPathParam(routeParams, 'projectId');
      const taskId = getPathParam(routeParams, 'taskId');
      const draftId = getPathParam(routeParams, 'draftId');
      return projectId && taskId && draftId
        ? {
            kind: 'project-task-workspace-create',
            projectId,
            taskId,
            draftId,
          }
        : null;
    }
    case '/_app/projects/$projectId_/tasks/$taskId_/hosts/$hostId/workspaces/create/$draftId': {
      const projectId = getPathParam(routeParams, 'projectId');
      const taskId = getPathParam(routeParams, 'taskId');
      const hostId = getPathParam(routeParams, 'hostId');
      const draftId = getPathParam(routeParams, 'draftId');
      return projectId && taskId && hostId && draftId
        ? {
            kind: 'project-task-workspace-create',
            projectId,
            taskId,
            hostId,
            draftId,
          }
        : null;
    }
    case '/_app/projects/$projectId_/workspaces/create/$draftId': {
      const projectId = getPathParam(routeParams, 'projectId');
      const draftId = getPathParam(routeParams, 'draftId');
      return projectId && draftId
        ? {
            kind: 'project-workspace-create',
            projectId,
            draftId,
          }
        : null;
    }
    case '/_app/projects/$projectId_/hosts/$hostId/workspaces/create/$draftId': {
      const projectId = getPathParam(routeParams, 'projectId');
      const hostId = getPathParam(routeParams, 'hostId');
      const draftId = getPathParam(routeParams, 'draftId');
      return projectId && hostId && draftId
        ? {
            kind: 'project-workspace-create',
            projectId,
            hostId,
            draftId,
          }
        : null;
    }
    default:
      return null;
  }
}

function resolveLocalDestinationFromPath(path: string): AppDestination | null {
  const destination = resolveLocalDestinationFromPathUnscoped(path);
  const hostId = new URL(path, 'http://localhost').searchParams.get('host_id');
  if (
    hostId &&
    (isProjectDestination(destination) ||
      destination?.kind === 'project-directory' ||
      destination?.kind === 'workflow-directory')
  ) {
    return { ...destination, hostId: destination.hostId ?? hostId };
  }
  return destination;
}

function destinationToLocalTarget(
  destination: AppDestination,
  options: { currentHostId: string | null }
) {
  const destinationHostId =
    'hostId' in destination ? (destination.hostId ?? null) : null;
  const effectiveHostId = destinationHostId ?? options.currentHostId;

  switch (destination.kind) {
    case 'root':
      return { to: '/' } as const;
    case 'onboarding':
      return { to: '/onboarding' } as const;
    case 'onboarding-sign-in':
      return { to: '/onboarding/sign-in' } as const;
    case 'workspaces':
      if (effectiveHostId) {
        return {
          to: '/hosts/$hostId/workspaces',
          params: { hostId: effectiveHostId },
        } as const;
      }
      return { to: '/workspaces' } as const;
    case 'workspaces-create':
      if (effectiveHostId) {
        return {
          to: '/hosts/$hostId/workspaces/create',
          params: { hostId: effectiveHostId },
        } as const;
      }
      return { to: '/workspaces/create' } as const;
    case 'workspace':
      if (effectiveHostId) {
        return {
          to: '/hosts/$hostId/workspaces/$workspaceId',
          params: {
            hostId: effectiveHostId,
            workspaceId: destination.workspaceId,
          },
        } as const;
      }
      return {
        to: '/workspaces/$workspaceId',
        params: { workspaceId: destination.workspaceId },
      } as const;
    case 'workspace-vscode':
      if (effectiveHostId) {
        return {
          to: '/hosts/$hostId/workspaces/$workspaceId/vscode',
          params: {
            hostId: effectiveHostId,
            workspaceId: destination.workspaceId,
          },
        } as const;
      }
      return {
        to: '/workspaces/$workspaceId/vscode',
        params: { workspaceId: destination.workspaceId },
      } as const;
    case 'export':
      return { to: '/export' } as const;
    case 'project-directory':
      return { to: '/projects' } as const;
    case 'workflow-directory':
      return { to: '/workflows' } as const;
    case 'project':
      return {
        to: '/projects/$projectId',
        params: { projectId: destination.projectId },
      } as const;
    case 'project-workflows':
      return {
        to: '/projects/$projectId/workflows',
        params: { projectId: destination.projectId },
      } as const;
    case 'project-workflow-edit':
      return {
        to: '/projects/$projectId/workflows/$workflowId/edit',
        params: {
          projectId: destination.projectId,
          workflowId: destination.workflowId,
        },
      } as const;
    case 'project-workflow-run':
      return {
        to: '/projects/$projectId/workflow-runs/$runId',
        params: {
          projectId: destination.projectId,
          runId: destination.runId,
        },
      } as const;
    case 'project-task':
      return {
        to: '/projects/$projectId/tasks/$taskId',
        params: {
          projectId: destination.projectId,
          taskId: destination.taskId,
        },
      } as const;
    case 'project-task-arena':
      return {
        to: '/projects/$projectId/tasks/$taskId/arena/$groupId',
        params: {
          projectId: destination.projectId,
          taskId: destination.taskId,
          groupId: destination.arenaGroupId,
        },
      } as const;
    case 'project-task-workspace':
      if (effectiveHostId) {
        return {
          to: '/projects/$projectId/tasks/$taskId/hosts/$hostId/workspaces/$workspaceId',
          params: {
            projectId: destination.projectId,
            taskId: destination.taskId,
            hostId: effectiveHostId,
            workspaceId: destination.workspaceId,
          },
        } as const;
      }
      return {
        to: '/projects/$projectId/tasks/$taskId/workspaces/$workspaceId',
        params: {
          projectId: destination.projectId,
          taskId: destination.taskId,
          workspaceId: destination.workspaceId,
        },
      } as const;
    case 'project-task-workspace-create':
      if (effectiveHostId) {
        return {
          to: '/projects/$projectId/tasks/$taskId/hosts/$hostId/workspaces/create/$draftId',
          params: {
            projectId: destination.projectId,
            taskId: destination.taskId,
            hostId: effectiveHostId,
            draftId: destination.draftId,
          },
        } as const;
      }
      return {
        to: '/projects/$projectId/tasks/$taskId/workspaces/create/$draftId',
        params: {
          projectId: destination.projectId,
          taskId: destination.taskId,
          draftId: destination.draftId,
        },
      } as const;
    case 'project-workspace-create':
      if (effectiveHostId) {
        return {
          to: '/projects/$projectId/hosts/$hostId/workspaces/create/$draftId',
          params: {
            projectId: destination.projectId,
            hostId: effectiveHostId,
            draftId: destination.draftId,
          },
        } as const;
      }
      return {
        to: '/projects/$projectId/workspaces/create/$draftId',
        params: {
          projectId: destination.projectId,
          draftId: destination.draftId,
        },
      } as const;
  }
}

export function createLocalAppNavigation(): AppNavigation {
  const navigateTo = (
    destination: AppDestination,
    transition?: NavigationTransition
  ) => {
    const currentHostId =
      transition?.hostId !== undefined
        ? transition.hostId
        : typeof window === 'undefined'
          ? null
          : (parseLocalHostIdFromPathname(window.location.pathname) ??
            new URLSearchParams(window.location.search).get('host_id'));

    void router.navigate({
      ...destinationToLocalTarget(destination, { currentHostId }),
      ...(isProjectDestination(destination) ||
      destination.kind === 'project-directory'
        ? { search: { host_id: currentHostId ?? undefined } }
        : {}),
      ...(transition?.replace !== undefined
        ? { replace: transition.replace }
        : {}),
    });
  };

  const navigation: AppNavigation = {
    resolveFromPath: (path) => resolveLocalDestinationFromPath(path),
    goToRoot: (transition) => navigateTo({ kind: 'root' }, transition),
    goToOnboarding: (transition) =>
      navigateTo({ kind: 'onboarding' }, transition),
    goToOnboardingSignIn: (transition) =>
      navigateTo({ kind: 'onboarding-sign-in' }, transition),
    goToWorkspaces: (transition) =>
      navigateTo({ kind: 'workspaces' }, transition),
    goToWorkspacesCreate: (transition) =>
      navigateTo({ kind: 'workspaces-create' }, transition),
    goToWorkspace: (workspaceId, transition) =>
      navigateTo({ kind: 'workspace', workspaceId }, transition),
    goToWorkspaceVsCode: (workspaceId, transition) =>
      navigateTo({ kind: 'workspace-vscode', workspaceId }, transition),
    goToExport: (transition) => navigateTo({ kind: 'export' }, transition),
    goToProject: (projectId, transition) =>
      navigateTo({ kind: 'project', projectId }, transition),
    goToProjectWorkflows: (projectId, transition) =>
      navigateTo({ kind: 'project-workflows', projectId }, transition),
    goToProjectWorkflowEdit: (projectId, workflowId, transition) =>
      navigateTo(
        { kind: 'project-workflow-edit', projectId, workflowId },
        transition
      ),
    goToProjectWorkflowRun: (projectId, runId, transition) =>
      navigateTo(
        { kind: 'project-workflow-run', projectId, runId },
        transition
      ),
    goToProjectTask: (projectId, taskId, transition) =>
      navigateTo({ kind: 'project-task', projectId, taskId }, transition),
    goToProjectTaskArena: (projectId, taskId, arenaGroupId, transition) =>
      navigateTo(
        { kind: 'project-task-arena', projectId, taskId, arenaGroupId },
        transition
      ),
    goToProjectTaskWorkspace: (projectId, taskId, workspaceId, transition) =>
      navigateTo(
        { kind: 'project-task-workspace', projectId, taskId, workspaceId },
        transition
      ),
    goToProjectTaskWorkspaceCreate: (projectId, taskId, draftId, transition) =>
      navigateTo(
        { kind: 'project-task-workspace-create', projectId, taskId, draftId },
        transition
      ),
    goToProjectWorkspaceCreate: (projectId, draftId, transition) =>
      navigateTo(
        { kind: 'project-workspace-create', projectId, draftId },
        transition
      ),
  };

  return navigation;
}

export const localAppNavigation = createLocalAppNavigation();
