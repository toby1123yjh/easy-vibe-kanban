import {
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useParams } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { Workspace } from "shared/types";
import {
  ActionsContext,
  type ActionsContextValue,
} from "@/shared/hooks/useActions";
import { UserContext } from "@/shared/hooks/useUserContext";
import {
  type ActionDefinition,
  type ActionExecutorContext,
  type ActionVisibilityContext,
  getActionLabel,
  resolveLabel,
  type ProjectMutations,
} from "@/shared/types/actions";
import { useSettingsNavigation } from "@/shared/hooks/useSettingsNavigation";
import { useAppNavigation } from "@/shared/hooks/useAppNavigation";
import { useAppRuntime } from "@/shared/hooks/useAppRuntime";
import { useOrganizationStore } from "@/shared/stores/useOrganizationStore";
import {
  buildKanbanTaskComposerKey,
  openKanbanTaskComposer,
  type ProjectTaskCreateOptions,
} from "@/shared/stores/useKanbanTaskComposerStore";

interface RemoteActionsProviderProps {
  children: ReactNode;
}

function noOpSelection(name: string) {
  console.warn(`[RemoteActionsProvider] ${name} is unavailable in remote web.`);
}

export function RemoteActionsProvider({
  children,
}: RemoteActionsProviderProps) {
  const appRuntime = useAppRuntime();
  const appNavigation = useAppNavigation();
  const { openSettings } = useSettingsNavigation();
  const queryClient = useQueryClient();
  const { projectId, hostId } = useParams({ strict: false });
  const userCtx = useContext(UserContext);
  const selectedOrgId = useOrganizationStore((s) => s.selectedOrgId);
  const [defaultCreateStatusId, setDefaultCreateStatusId] = useState<
    string | undefined
  >();
  const [projectMutations, setProjectMutations] =
    useState<ProjectMutations | null>(null);

  const registerProjectMutations = useCallback(
    (mutations: ProjectMutations | null) => {
      setProjectMutations(mutations);
    },
    [],
  );

  const navigateToCreateTask = useCallback(
    (options?: ProjectTaskCreateOptions) => {
      if (!projectId) return;
      openKanbanTaskComposer(
        buildKanbanTaskComposerKey(hostId ?? null, projectId),
        options,
      );
    },
    [hostId, projectId],
  );

  const openStatusSelection = useCallback(async () => {
    noOpSelection("Status selection");
  }, []);

  const openPrioritySelection = useCallback(async () => {
    noOpSelection("Priority selection");
  }, []);

  const openAssigneeSelection = useCallback(async () => {
    noOpSelection("Assignee selection");
  }, []);

  const openSubTaskSelection = useCallback(async () => {
    noOpSelection("Sub-task selection");
    return undefined;
  }, []);

  const openWorkspaceSelection = useCallback(async () => {
    noOpSelection("Workspace selection");
  }, []);

  const openRelationshipSelection = useCallback(async () => {
    noOpSelection("Relationship selection");
  }, []);

  const executorContext = useMemo<ActionExecutorContext>(
    () => ({
      appRuntime,
      currentHostId: hostId ?? null,
      appNavigation,
      openSettings,
      queryClient,
      selectWorkspace: () => {
        noOpSelection("Workspace actions");
      },
      activeWorkspaces: [],
      currentWorkspaceId: null,
      containerRef: null,
      runningDevServers: [],
      startDevServer: () => {
        noOpSelection("Dev server actions");
      },
      stopDevServer: () => {
        noOpSelection("Dev server actions");
      },
      currentLogs: null,
      logsPanelContent: null,
      openStatusSelection,
      openPrioritySelection,
      openAssigneeSelection,
      openSubTaskSelection,
      openWorkspaceSelection,
      openRelationshipSelection,
      navigateToCreateTask,
      defaultCreateStatusId,
      kanbanOrgId: selectedOrgId ?? undefined,
      kanbanProjectId: projectId,
      projectMutations: projectMutations ?? undefined,
      remoteWorkspaces: userCtx?.workspaces ?? [],
    }),
    [
      appRuntime,
      appNavigation,
      openSettings,
      hostId,
      queryClient,
      openStatusSelection,
      openPrioritySelection,
      openAssigneeSelection,
      openSubTaskSelection,
      openWorkspaceSelection,
      openRelationshipSelection,
      navigateToCreateTask,
      defaultCreateStatusId,
      selectedOrgId,
      projectId,
      projectMutations,
      userCtx?.workspaces,
    ],
  );

  const executeAction = useCallback(
    async (action: ActionDefinition): Promise<void> => {
      if (action.id === "settings") {
        openSettings("application");
        return;
      }

      if (action.id === "project-settings") {
        openSettings("projects");
        return;
      }

      console.warn(
        `[RemoteActionsProvider] Action "${action.id}" is unavailable in remote web.`,
      );
    },
    [openSettings],
  );

  const getLabel = useCallback(
    (
      action: ActionDefinition,
      workspace?: Workspace,
      ctx?: ActionVisibilityContext,
    ) => {
      if (ctx) {
        return getActionLabel(action, ctx, workspace);
      }
      return resolveLabel(action, workspace);
    },
    [],
  );

  const value = useMemo<ActionsContextValue>(
    () => ({
      executeAction,
      getLabel,
      openStatusSelection,
      openPrioritySelection,
      openAssigneeSelection,
      openSubTaskSelection,
      openWorkspaceSelection,
      openRelationshipSelection,
      setDefaultCreateStatusId,
      registerProjectMutations,
      executorContext,
    }),
    [
      executeAction,
      getLabel,
      openStatusSelection,
      openPrioritySelection,
      openAssigneeSelection,
      openSubTaskSelection,
      openWorkspaceSelection,
      openRelationshipSelection,
      registerProjectMutations,
      executorContext,
    ],
  );

  return (
    <ActionsContext.Provider value={value}>{children}</ActionsContext.Provider>
  );
}
