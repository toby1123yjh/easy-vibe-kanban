import { router } from "@remote/app/router";
import type { FileRouteTypes } from "@remote/routeTree.gen";
import {
  type AppDestination,
  type AppNavigation,
  type NavigationTransition,
} from "@/shared/lib/routes/appNavigation";

type RemoteRouteId = FileRouteTypes["id"];

function getPathParam(
  routeParams: Record<string, string>,
  key: string,
): string | null {
  const value = routeParams[key];
  return value ? value : null;
}

export function resolveRemoteDestinationFromPath(
  path: string,
): AppDestination | null {
  const { pathname } = new URL(path, "http://localhost");
  const { foundRoute, routeParams } = router.getMatchedRoutes(pathname);

  if (!foundRoute) {
    return null;
  }

  switch (foundRoute.id as RemoteRouteId) {
    case "/":
      return { kind: "root" };
    case "/export":
      return { kind: "export" };
    case "/hosts/$hostId/workspaces": {
      const hostId = getPathParam(routeParams, "hostId");
      return hostId ? { kind: "workspaces", hostId } : null;
    }
    case "/hosts/$hostId/workspaces_/create": {
      const hostId = getPathParam(routeParams, "hostId");
      return hostId ? { kind: "workspaces-create", hostId } : null;
    }
    case "/hosts/$hostId/workspaces_/$workspaceId": {
      const hostId = getPathParam(routeParams, "hostId");
      const workspaceId = getPathParam(routeParams, "workspaceId");
      return hostId && workspaceId
        ? { kind: "workspace", hostId, workspaceId }
        : null;
    }
    case "/hosts/$hostId/workspaces/$workspaceId/vscode": {
      const hostId = getPathParam(routeParams, "hostId");
      const workspaceId = getPathParam(routeParams, "workspaceId");
      return hostId && workspaceId
        ? { kind: "workspace-vscode", hostId, workspaceId }
        : null;
    }
    case "/projects/$projectId": {
      const projectId = getPathParam(routeParams, "projectId");
      return projectId ? { kind: "project", projectId } : null;
    }
    case "/projects/$projectId_/tasks/$taskId": {
      const projectId = getPathParam(routeParams, "projectId");
      const taskId = getPathParam(routeParams, "taskId");
      return projectId && taskId
        ? { kind: "project-task", projectId, taskId }
        : null;
    }
    case "/projects/$projectId_/tasks/$taskId_/hosts/$hostId/workspaces/$workspaceId": {
      const projectId = getPathParam(routeParams, "projectId");
      const taskId = getPathParam(routeParams, "taskId");
      const hostId = getPathParam(routeParams, "hostId");
      const workspaceId = getPathParam(routeParams, "workspaceId");
      return projectId && taskId && hostId && workspaceId
        ? {
            kind: "project-task-workspace",
            projectId,
            taskId,
            hostId,
            workspaceId,
          }
        : null;
    }
    case "/projects/$projectId_/tasks/$taskId_/hosts/$hostId/workspaces/create/$draftId": {
      const projectId = getPathParam(routeParams, "projectId");
      const taskId = getPathParam(routeParams, "taskId");
      const hostId = getPathParam(routeParams, "hostId");
      const draftId = getPathParam(routeParams, "draftId");
      return projectId && taskId && hostId && draftId
        ? {
            kind: "project-task-workspace-create",
            projectId,
            taskId,
            hostId,
            draftId,
          }
        : null;
    }
    case "/projects/$projectId_/hosts/$hostId/workspaces/create/$draftId": {
      const projectId = getPathParam(routeParams, "projectId");
      const hostId = getPathParam(routeParams, "hostId");
      const draftId = getPathParam(routeParams, "draftId");
      return projectId && hostId && draftId
        ? {
            kind: "project-workspace-create",
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

function destinationToRemoteTarget(
  destination: AppDestination,
  options: { currentHostId: string | null },
) {
  const destinationHostId =
    "hostId" in destination ? (destination.hostId ?? null) : null;
  const effectiveHostId = destinationHostId ?? options.currentHostId;

  switch (destination.kind) {
    case "root":
      return { to: "/" } as const;
    case "onboarding":
      return { to: "/" } as const;
    case "onboarding-sign-in":
      return { to: "/" } as const;
    case "workspaces":
      if (effectiveHostId) {
        return {
          to: "/hosts/$hostId/workspaces",
          params: { hostId: effectiveHostId },
        } as const;
      }
      return { to: "/" } as const;
    case "workspaces-create":
      if (effectiveHostId) {
        return {
          to: "/hosts/$hostId/workspaces/create",
          params: { hostId: effectiveHostId },
        } as const;
      }
      return { to: "/" } as const;
    case "workspace":
      if (effectiveHostId) {
        return {
          to: "/hosts/$hostId/workspaces/$workspaceId",
          params: {
            hostId: effectiveHostId,
            workspaceId: destination.workspaceId,
          },
        } as const;
      }
      return { to: "/" } as const;
    case "workspace-vscode":
      if (effectiveHostId) {
        return {
          to: "/hosts/$hostId/workspaces/$workspaceId/vscode",
          params: {
            hostId: effectiveHostId,
            workspaceId: destination.workspaceId,
          },
        } as const;
      }
      return { to: "/" } as const;
    case "export":
      return { to: "/export" } as const;
    case "project-directory":
    case "workflow-directory":
      return { to: "/" } as const;
    case "project":
      return {
        to: "/projects/$projectId",
        params: { projectId: destination.projectId },
      } as const;
    case "project-workflows":
      return {
        to: "/projects/$projectId",
        params: { projectId: destination.projectId },
      } as const;
    case "project-workflow-edit":
      return {
        to: "/projects/$projectId",
        params: { projectId: destination.projectId },
      } as const;
    case "project-workflow-run":
      return {
        to: "/projects/$projectId",
        params: { projectId: destination.projectId },
      } as const;
    case "project-task":
      return {
        to: "/projects/$projectId/tasks/$taskId",
        params: {
          projectId: destination.projectId,
          taskId: destination.taskId,
        },
      } as const;
    case "project-task-arena":
      // Remote does not currently own an Arena comparison route. The shared
      // UI detects the absent navigation action and fails closed before this
      // fallback can be reached.
      return {
        to: "/projects/$projectId/tasks/$taskId",
        params: {
          projectId: destination.projectId,
          taskId: destination.taskId,
        },
      } as const;
    case "project-task-workspace":
      return {
        to: "/projects/$projectId/tasks/$taskId/hosts/$hostId/workspaces/$workspaceId",
        params: {
          projectId: destination.projectId,
          taskId: destination.taskId,
          hostId: destination.hostId,
          workspaceId: destination.workspaceId,
        },
      } as const;
    case "project-task-workspace-create":
      return {
        to: "/projects/$projectId/tasks/$taskId/hosts/$hostId/workspaces/create/$draftId",
        params: {
          projectId: destination.projectId,
          taskId: destination.taskId,
          hostId: destination.hostId,
          draftId: destination.draftId,
        },
      } as const;
    case "project-workspace-create":
      return {
        to: "/projects/$projectId/hosts/$hostId/workspaces/create/$draftId",
        params: {
          projectId: destination.projectId,
          hostId: destination.hostId,
          draftId: destination.draftId,
        },
      } as const;
  }
}

export function createRemoteHostAppNavigation(hostId: string): AppNavigation {
  const navigateTo = (
    destination: AppDestination,
    transition?: NavigationTransition,
  ) => {
    void router.navigate({
      ...destinationToRemoteTarget(destination, {
        currentHostId: hostId,
      }),
      ...(transition?.replace !== undefined
        ? { replace: transition.replace }
        : {}),
    });
  };

  const navigation: AppNavigation = {
    projectWorkflowUnavailableReason:
      "Workflow authoring and runs are unavailable in Remote.",
    resolveFromPath: (path) => resolveRemoteDestinationFromPath(path),
    goToRoot: (transition) => navigateTo({ kind: "root" }, transition),
    goToOnboarding: (transition) =>
      navigateTo({ kind: "onboarding" }, transition),
    goToOnboardingSignIn: (transition) =>
      navigateTo({ kind: "onboarding-sign-in" }, transition),
    goToWorkspaces: (transition) =>
      navigateTo({ kind: "workspaces", hostId }, transition),
    goToWorkspacesCreate: (transition) =>
      navigateTo({ kind: "workspaces-create", hostId }, transition),
    goToWorkspace: (workspaceId, transition) =>
      navigateTo({ kind: "workspace", hostId, workspaceId }, transition),
    goToWorkspaceVsCode: (workspaceId, transition) =>
      navigateTo({ kind: "workspace-vscode", hostId, workspaceId }, transition),
    goToExport: (transition) => navigateTo({ kind: "export" }, transition),
    goToProject: (projectId, transition) =>
      navigateTo({ kind: "project", projectId }, transition),
    goToProjectWorkflows: (projectId, transition) =>
      navigateTo({ kind: "project-workflows", projectId }, transition),
    goToProjectWorkflowEdit: (projectId, _workflowId, transition) =>
      navigateTo(
        { kind: "project-workflow-edit", projectId, workflowId: _workflowId },
        transition,
      ),
    goToProjectWorkflowRun: (projectId, _runId, transition) =>
      navigateTo(
        { kind: "project-workflow-run", projectId, runId: _runId },
        transition,
      ),
    goToProjectTask: (projectId, taskId, transition) =>
      navigateTo({ kind: "project-task", projectId, taskId }, transition),
    goToProjectTaskWorkspace: (projectId, taskId, workspaceId, transition) =>
      navigateTo(
        {
          kind: "project-task-workspace",
          hostId,
          projectId,
          taskId,
          workspaceId,
        },
        transition,
      ),
    goToProjectTaskWorkspaceCreate: (projectId, taskId, draftId, transition) =>
      navigateTo(
        {
          kind: "project-task-workspace-create",
          hostId,
          projectId,
          taskId,
          draftId,
        },
        transition,
      ),
    goToProjectWorkspaceCreate: (projectId, draftId, transition) =>
      navigateTo(
        { kind: "project-workspace-create", hostId, projectId, draftId },
        transition,
      ),
  };

  return navigation;
}

function createRemoteFallbackAppNavigation(): AppNavigation {
  const navigateTo = (
    destination: AppDestination,
    transition?: NavigationTransition,
  ) => {
    void router.navigate({
      ...destinationToRemoteTarget(destination, {
        currentHostId: null,
      }),
      ...(transition?.replace !== undefined
        ? { replace: transition.replace }
        : {}),
    });
  };

  const navigation: AppNavigation = {
    agentExecutionUnavailableReason:
      "Connect an online Host before starting or opening an Agent execution.",
    projectWorkflowUnavailableReason:
      "Workflow authoring and runs are unavailable in Remote.",
    resolveFromPath: (path) => resolveRemoteDestinationFromPath(path),
    goToRoot: (transition) => navigateTo({ kind: "root" }, transition),
    goToOnboarding: (transition) =>
      navigateTo({ kind: "onboarding" }, transition),
    goToOnboardingSignIn: (transition) =>
      navigateTo({ kind: "onboarding-sign-in" }, transition),
    goToWorkspaces: (transition) =>
      navigateTo({ kind: "workspaces" }, transition),
    goToWorkspacesCreate: (transition) =>
      navigateTo({ kind: "workspaces-create" }, transition),
    goToWorkspace: (workspaceId, transition) =>
      navigateTo({ kind: "workspace", workspaceId }, transition),
    goToWorkspaceVsCode: (workspaceId, transition) =>
      navigateTo({ kind: "workspace-vscode", workspaceId }, transition),
    goToExport: (transition) => navigateTo({ kind: "export" }, transition),
    goToProject: (projectId, transition) =>
      navigateTo({ kind: "project", projectId }, transition),
    goToProjectWorkflows: (projectId, transition) =>
      navigateTo({ kind: "project-workflows", projectId }, transition),
    goToProjectWorkflowEdit: (projectId, _workflowId, transition) =>
      navigateTo(
        { kind: "project-workflow-edit", projectId, workflowId: _workflowId },
        transition,
      ),
    goToProjectWorkflowRun: (projectId, _runId, transition) =>
      navigateTo(
        { kind: "project-workflow-run", projectId, runId: _runId },
        transition,
      ),
    goToProjectTask: (projectId, taskId, transition) =>
      navigateTo({ kind: "project-task", projectId, taskId }, transition),
    goToProjectTaskWorkspace: (projectId, taskId, workspaceId, transition) =>
      navigateTo(
        { kind: "project-task-workspace", projectId, taskId, workspaceId },
        transition,
      ),
    goToProjectTaskWorkspaceCreate: (projectId, taskId, draftId, transition) =>
      navigateTo(
        { kind: "project-task-workspace-create", projectId, taskId, draftId },
        transition,
      ),
    goToProjectWorkspaceCreate: (projectId, draftId, transition) =>
      navigateTo(
        { kind: "project-workspace-create", projectId, draftId },
        transition,
      ),
  };

  return navigation;
}

export const remoteFallbackAppNavigation = createRemoteFallbackAppNavigation();
