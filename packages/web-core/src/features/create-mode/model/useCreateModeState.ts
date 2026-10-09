import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import type {
  DraftWorkspaceData,
  DraftWorkspaceAttachment,
  ExecutorConfig,
  Repo,
} from 'shared/types';
import { ScratchType } from 'shared/types';
import { PROJECT_TASKS_SHAPE } from 'shared/remote-types';
import { useScratch } from '@/shared/hooks/useScratch';
import { useDebouncedCallback } from '@/shared/hooks/useDebouncedCallback';
import { useUserSystem } from '@/shared/hooks/useUserSystem';
import { useShape } from '@/shared/integrations/electric/hooks';
import { repoApi } from '@/shared/lib/api';
import { resolveCreateModeBootstrap } from '@/features/create-mode/model/createModeBootstrap';
import { useWorkspaceCreateDefaults } from '@/shared/hooks/useWorkspaceCreateDefaults';
import { getValidProjectWorkspaceDefault } from '@/shared/hooks/useProjectRepoDefaults';
import type {
  CreateModeInitialState,
  LinkedTask,
} from '@/shared/types/createMode';

// ============================================================================
// Types
// ============================================================================

/** Unified repo model - keeps repo and branch together */
interface SelectedRepo {
  repo: Repo;
  targetBranch: string | null;
}

type Phase = 'loading' | 'ready' | 'error';

interface DraftState {
  phase: Phase;
  error: string | null;
  repos: SelectedRepo[];
  directFolderPath: string;
  message: string;
  linkedTask: LinkedTask | null;
  executorConfig: ExecutorConfig | null;
  attachments: DraftWorkspaceAttachment[];
}

type DraftAction =
  | {
      type: 'INIT_COMPLETE';
      data: Partial<Omit<DraftState, 'phase' | 'error'>>;
    }
  | { type: 'INIT_ERROR'; error: string }
  | { type: 'SET_PROJECT'; projectId: string | null }
  | { type: 'ADD_REPO'; repo: Repo; targetBranch: string | null }
  | { type: 'SET_REPOS_IF_EMPTY'; repos: SelectedRepo[] }
  | { type: 'REMOVE_REPO'; repoId: string }
  | { type: 'SET_TARGET_BRANCH'; repoId: string; branch: string }
  | { type: 'SET_DIRECT_FOLDER_PATH'; path: string }
  | { type: 'SET_MESSAGE'; message: string }
  | { type: 'CLEAR_REPOS' }
  | { type: 'CLEAR' }
  | { type: 'CLEAR_LINKED_TASK' }
  | { type: 'RESOLVE_LINKED_TASK'; simpleId: string; title: string }
  | {
      type: 'SET_EXECUTOR_CONFIG';
      config: ExecutorConfig | null;
    }
  | { type: 'SET_ATTACHMENTS'; attachments: DraftWorkspaceAttachment[] };

// ============================================================================
// Reducer
// ============================================================================

const draftInitialState: DraftState = {
  phase: 'loading',
  error: null,
  repos: [],
  directFolderPath: '',
  message: '',
  linkedTask: null,
  executorConfig: null,
  attachments: [],
};

function draftReducer(state: DraftState, action: DraftAction): DraftState {
  switch (action.type) {
    case 'INIT_COMPLETE':
      return {
        ...state,
        phase: 'ready',
        error: null,
        ...action.data,
      };

    case 'INIT_ERROR':
      return {
        ...state,
        phase: 'error',
        error: action.error,
      };

    case 'ADD_REPO': {
      // Don't add duplicate repos
      if (state.repos.some((r) => r.repo.id === action.repo.id)) {
        return state;
      }
      return {
        ...state,
        directFolderPath: '',
        repos: [
          ...state.repos,
          { repo: action.repo, targetBranch: action.targetBranch },
        ],
      };
    }

    case 'SET_REPOS_IF_EMPTY':
      if (state.repos.length > 0 || state.directFolderPath) {
        return state;
      }
      return { ...state, repos: action.repos };

    case 'REMOVE_REPO':
      return {
        ...state,
        repos: state.repos.filter((r) => r.repo.id !== action.repoId),
      };

    case 'SET_TARGET_BRANCH':
      return {
        ...state,
        repos: state.repos.map((r) =>
          r.repo.id === action.repoId
            ? { ...r, targetBranch: action.branch }
            : r
        ),
      };

    case 'SET_DIRECT_FOLDER_PATH':
      return {
        ...state,
        repos: [],
        directFolderPath: action.path,
      };

    case 'SET_MESSAGE':
      return { ...state, message: action.message };

    case 'CLEAR_REPOS':
      return { ...state, repos: [] };

    case 'CLEAR':
      return { ...draftInitialState, phase: 'ready' };

    case 'CLEAR_LINKED_TASK':
      return { ...state, linkedTask: null };

    case 'RESOLVE_LINKED_TASK':
      if (!state.linkedTask) return state;
      return {
        ...state,
        linkedTask: {
          ...state.linkedTask,
          simpleId: action.simpleId,
          title: action.title,
        },
      };

    case 'SET_EXECUTOR_CONFIG':
      return { ...state, executorConfig: action.config };

    case 'SET_ATTACHMENTS':
      return { ...state, attachments: action.attachments };

    default:
      return state;
  }
}

// ============================================================================
// Constants
// ============================================================================

const DRAFT_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';

// ============================================================================
// Hook
// ============================================================================

interface UseCreateModeStateParams {
  initialState?: CreateModeInitialState | null;
  draftId?: string | null;
  hostId?: string | null;
  lastWorkspaceId: string | null;
  localWorkspacesLoading: boolean;
}

interface UseCreateModeStateResult {
  repos: Repo[];
  targetBranches: Record<string, string | null>;
  directFolderPath: string;
  hasResolvedInitialWorkspaceDefaults: boolean;
  preferredExecutorConfig: ExecutorConfig | null;
  message: string;
  isLoading: boolean;
  hasInitialValue: boolean;
  linkedTask: LinkedTask | null;
  executorConfig: ExecutorConfig | null;
  setMessage: (message: string) => void;
  addRepo: (repo: Repo) => void;
  removeRepo: (repoId: string) => void;
  clearRepos: () => void;
  setTargetBranch: (repoId: string, branch: string) => void;
  setDirectFolderPath: (path: string) => void;
  clearDraft: () => Promise<void>;
  clearLinkedTask: () => void;
  setExecutorConfig: (config: ExecutorConfig | null) => void;
  attachments: DraftWorkspaceAttachment[];
  setAttachments: (attachments: DraftWorkspaceAttachment[]) => void;
}

export function useCreateModeState({
  initialState,
  draftId,
  hostId,
  lastWorkspaceId,
  localWorkspacesLoading,
}: UseCreateModeStateParams): UseCreateModeStateResult {
  const { profiles, config, loading: systemLoading } = useUserSystem();
  const scratchId = draftId ?? DRAFT_WORKSPACE_ID;

  const {
    scratch,
    updateScratch,
    deleteScratch,
    isLoading: scratchLoading,
  } = useScratch(ScratchType.DRAFT_WORKSPACE, scratchId);

  const [state, dispatch] = useReducer(draftReducer, draftInitialState);

  // Capture initial seed state once on mount.
  const seedStateRef = useRef<CreateModeInitialState | null>(
    initialState ?? null
  );
  const hasInitialized = useRef(false);

  // Profile validator
  const isValidProfile = useCallback(
    (config: ExecutorConfig | null): boolean => {
      if (!config || !profiles) return false;
      const { executor, variant } = config;
      if (!(executor in profiles)) return false;
      if (variant === null || variant === undefined) return true;
      return variant in profiles[executor];
    },
    [profiles]
  );

  // ============================================================================
  // Single initialization effect
  // ============================================================================
  useEffect(() => {
    if (hasInitialized.current) return;
    if (scratchLoading) return;
    if (systemLoading) return;
    if (!profiles) return;

    hasInitialized.current = true;
    const seedState = seedStateRef.current;
    const scratchData: DraftWorkspaceData | undefined =
      scratch?.payload?.type === 'DRAFT_WORKSPACE'
        ? scratch.payload.data
        : undefined;

    void resolveCreateModeBootstrap({
      seedState,
      scratchData,
      defaultExecutorConfig: config?.executor_profile
        ? {
            executor: config.executor_profile.executor,
            variant: config.executor_profile.variant,
          }
        : null,
      isValidProfile,
    })
      .then(({ data }) => {
        dispatch({ type: 'INIT_COMPLETE', data });
      })
      .catch((e) => {
        console.error('[useCreateModeState] Initialization failed:', e);
        dispatch({
          type: 'INIT_ERROR',
          error: e instanceof Error ? e.message : 'Failed to initialize',
        });
      });
  }, [
    scratchLoading,
    systemLoading,
    profiles,
    config?.executor_profile,
    scratch,
    isValidProfile,
  ]);

  // ============================================================================
  // Auto-select project when none selected
  // ============================================================================
  const hasAttemptedAutoSelect = useRef(false);
  const repoDefaultsSourceRef = useRef<string | null>(null);
  const hasAppliedRepoDefaultsRef = useRef(false);
  const [projectDefaultsStatus, setProjectDefaultsStatus] = useState<
    'pending' | 'applied' | 'empty' | 'n/a'
  >('pending');
  const sourceWorkspaceId = state.linkedTask ? null : lastWorkspaceId;

  const shouldLoadWorkspaceDefaults =
    state.phase === 'ready' && !localWorkspacesLoading;

  const { preferredRepos, preferredExecutorConfig, hasResolvedPreferredRepos } =
    useWorkspaceCreateDefaults({
      sourceWorkspaceId,
      enabled: shouldLoadWorkspaceDefaults,
    });

  const hasResolvedInitialWorkspaceDefaults =
    (state.phase === 'ready' && !state.linkedTask) ||
    (state.phase === 'ready' &&
      !localWorkspacesLoading &&
      (!state.linkedTask?.remoteProjectId ||
        projectDefaultsStatus !== 'pending') &&
      hasResolvedPreferredRepos &&
      (preferredRepos.length === 0 ||
        state.repos.length > 0 ||
        Boolean(state.directFolderPath) ||
        hasAppliedRepoDefaultsRef.current)) ||
    state.repos.length > 0 ||
    Boolean(state.directFolderPath);

  useEffect(() => {
    if (state.phase !== 'ready') return;
    if (hasAttemptedAutoSelect.current) return;

    hasAttemptedAutoSelect.current = true;
  }, [state.phase]);

  // When no linked issue with a project, mark project defaults as not applicable
  useEffect(() => {
    if (state.phase !== 'ready') return;
    if (!state.linkedTask?.remoteProjectId) {
      setProjectDefaultsStatus('n/a');
    } else if (state.repos.length > 0 || state.directFolderPath) {
      setProjectDefaultsStatus('applied');
    }
  }, [
    state.phase,
    state.linkedTask?.remoteProjectId,
    state.repos.length,
    state.directFolderPath,
  ]);

  // ============================================================================
  // Auto-apply repos/branches defaults for fresh drafts
  // ============================================================================
  useEffect(() => {
    if (repoDefaultsSourceRef.current === sourceWorkspaceId) return;
    repoDefaultsSourceRef.current = sourceWorkspaceId;
    hasAppliedRepoDefaultsRef.current = false;
  }, [sourceWorkspaceId]);

  // When project defaults resolve as empty, allow Effect A to fire as fallback
  useEffect(() => {
    if (projectDefaultsStatus === 'empty') {
      hasAppliedRepoDefaultsRef.current = false;
    }
  }, [projectDefaultsStatus]);

  useEffect(() => {
    if (!shouldLoadWorkspaceDefaults) return;
    if (!hasResolvedPreferredRepos) return;
    // When a project is linked, wait for project defaults to resolve first
    if (
      state.linkedTask?.remoteProjectId &&
      projectDefaultsStatus === 'pending'
    )
      return;
    if (hasAppliedRepoDefaultsRef.current) return;

    hasAppliedRepoDefaultsRef.current = true;
    // Standalone chats get a fresh managed directory, never a previous chat's repo.
    if (!state.linkedTask?.remoteProjectId) return;
    if (state.repos.length > 0 || state.directFolderPath) return;
    if (preferredRepos.length === 0) return;

    dispatch({
      type: 'SET_REPOS_IF_EMPTY',
      repos: preferredRepos.map((repo) => ({
        repo,
        targetBranch: repo.target_branch || null,
      })),
    });
  }, [
    shouldLoadWorkspaceDefaults,
    hasResolvedPreferredRepos,
    state.repos.length,
    state.directFolderPath,
    preferredRepos,
    projectDefaultsStatus,
    state.linkedTask?.remoteProjectId,
  ]);

  // ============================================================================
  // Scratch project workspace default (async, non-blocking)
  // ============================================================================
  const scratchDefaultsProjectRef = useRef<string | null>(null);

  useEffect(() => {
    const remoteProjectId = state.linkedTask?.remoteProjectId;
    if (!remoteProjectId) return;
    if (state.repos.length > 0 || state.directFolderPath) return;
    const lookupKey = `${hostId ?? 'local'}:${remoteProjectId}`;
    if (scratchDefaultsProjectRef.current === lookupKey) return;

    scratchDefaultsProjectRef.current = lookupKey;
    let cancelled = false;

    (async () => {
      try {
        const allRepos = await repoApi.list(hostId);
        if (cancelled) return;

        const availableRepoIds = new Set(allRepos.map((r) => r.id));
        const scratchDefault = await getValidProjectWorkspaceDefault(
          remoteProjectId,
          availableRepoIds,
          hostId
        );
        if (cancelled) return;

        if (!scratchDefault) {
          setProjectDefaultsStatus('empty');
          return;
        }

        if (scratchDefault.kind === 'direct_folder') {
          dispatch({
            type: 'SET_DIRECT_FOLDER_PATH',
            path: scratchDefault.path,
          });
          setProjectDefaultsStatus('applied');
          return;
        }

        const repo = allRepos.find(
          (candidate) => candidate.id === scratchDefault.repo.repo_id
        );
        if (repo) {
          dispatch({
            type: 'SET_REPOS_IF_EMPTY',
            repos: [
              {
                repo,
                targetBranch: scratchDefault.repo.target_branch || null,
              },
            ],
          });
          setProjectDefaultsStatus('applied');
        } else {
          setProjectDefaultsStatus('empty');
        }
      } catch (err) {
        console.warn(
          '[useCreateModeState] Scratch defaults lookup failed:',
          err
        );
        setProjectDefaultsStatus('empty');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    hostId,
    state.linkedTask?.remoteProjectId,
    state.repos.length,
    state.directFolderPath,
  ]);

  // ============================================================================
  // Persistence to scratch (debounced)
  // ============================================================================
  const { debounced: debouncedSave } = useDebouncedCallback(
    async (data: DraftWorkspaceData) => {
      const isEmpty =
        !data.message.trim() &&
        data.repos.length === 0 &&
        !data.directory_path &&
        !data.executor_config &&
        data.attachments.length === 0;

      if (isEmpty && !scratch) return;

      try {
        await updateScratch({
          payload: { type: 'DRAFT_WORKSPACE', data },
        });
      } catch (e) {
        console.error('[useCreateModeState] Failed to save:', e);
      }
    },
    500
  );

  useEffect(() => {
    if (state.phase !== 'ready') return;

    debouncedSave({
      message: state.message,
      repos: state.repos.map((r) => ({
        repo_id: r.repo.id,
        target_branch: r.targetBranch ?? '',
      })),
      directory_path: state.directFolderPath.trim() || null,
      executor_config: state.executorConfig ?? null,
      linked_task: state.linkedTask
        ? {
            task_id: state.linkedTask.taskId,
            simple_id: state.linkedTask.simpleId ?? '',
            title: state.linkedTask.title ?? '',
            remote_project_id: state.linkedTask.remoteProjectId,
          }
        : null,
      attachments: state.attachments,
    });
  }, [
    state.phase,
    state.message,
    state.repos,
    state.directFolderPath,
    state.linkedTask,
    state.executorConfig,
    state.attachments,
    debouncedSave,
  ]);

  // ============================================================================
  // Resolve linked issue details from Electric (when simpleId/title are missing)
  // ============================================================================
  const needsTaskResolution = !!state.linkedTask && !state.linkedTask.simpleId;
  const taskProjectId = state.linkedTask?.remoteProjectId ?? '';

  const { data: tasksForResolution } = useShape(
    PROJECT_TASKS_SHAPE,
    { project_id: taskProjectId },
    { enabled: needsTaskResolution && !!taskProjectId }
  );

  useEffect(() => {
    if (!needsTaskResolution || !state.linkedTask) return;
    const task = tasksForResolution.find(
      (i) => i.id === state.linkedTask!.taskId
    );
    if (task) {
      dispatch({
        type: 'RESOLVE_LINKED_TASK',
        simpleId: task.simple_id,
        title: task.title,
      });
    }
  }, [needsTaskResolution, tasksForResolution, state.linkedTask]);

  // ============================================================================
  // Derived state
  // ============================================================================
  const repos = useMemo(() => state.repos.map((r) => r.repo), [state.repos]);

  const targetBranches = useMemo(
    () =>
      state.repos.reduce(
        (acc, r) => {
          acc[r.repo.id] = r.targetBranch;
          return acc;
        },
        {} as Record<string, string | null>
      ),
    [state.repos]
  );

  // ============================================================================
  // Actions
  // ============================================================================
  const setMessage = useCallback((message: string) => {
    dispatch({ type: 'SET_MESSAGE', message });
  }, []);

  const addRepo = useCallback((repo: Repo) => {
    // Branch is always selected manually by the user.
    dispatch({ type: 'ADD_REPO', repo, targetBranch: null });
  }, []);

  const removeRepo = useCallback((repoId: string) => {
    dispatch({ type: 'REMOVE_REPO', repoId });
  }, []);

  const clearRepos = useCallback(() => {
    dispatch({ type: 'CLEAR_REPOS' });
  }, []);

  const setTargetBranch = useCallback((repoId: string, branch: string) => {
    dispatch({ type: 'SET_TARGET_BRANCH', repoId, branch });
  }, []);

  const setDirectFolderPath = useCallback((path: string) => {
    dispatch({ type: 'SET_DIRECT_FOLDER_PATH', path });
  }, []);

  const clearDraft = useCallback(async () => {
    try {
      await deleteScratch();
      dispatch({ type: 'CLEAR' });
    } catch (e) {
      console.error('[useCreateModeState] Failed to clear:', e);
    }
  }, [deleteScratch]);

  const clearLinkedTask = useCallback(() => {
    dispatch({ type: 'CLEAR_LINKED_TASK' });
  }, []);

  const setExecutorConfig = useCallback((config: ExecutorConfig | null) => {
    dispatch({ type: 'SET_EXECUTOR_CONFIG', config });
  }, []);

  const setAttachments = useCallback(
    (attachments: DraftWorkspaceAttachment[]) => {
      dispatch({ type: 'SET_ATTACHMENTS', attachments });
    },
    []
  );

  return {
    repos,
    targetBranches,
    directFolderPath: state.directFolderPath,
    hasResolvedInitialWorkspaceDefaults,
    preferredExecutorConfig,
    message: state.message,
    isLoading: scratchLoading,
    hasInitialValue: state.phase === 'ready',
    linkedTask: state.linkedTask,
    executorConfig: state.executorConfig,
    setMessage,
    addRepo,
    removeRepo,
    clearRepos,
    setTargetBranch,
    setDirectFolderPath,
    clearDraft,
    clearLinkedTask,
    setExecutorConfig,
    attachments: state.attachments,
    setAttachments,
  };
}
