import { create, useModal } from '@ebay/nice-modal-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@vibe/ui/components/Button';
import { Input } from '@vibe/ui/components/Input';
import { Textarea } from '@vibe/ui/components/Textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@vibe/ui/components/KeyboardDialog';
import { BaseCodingAgent } from 'shared/types';
import type { Repo } from 'shared/types';
import { repoApi } from '@/shared/lib/api';
import {
  arenaApi,
  type ArenaMode,
  type CreateArenaRequest,
} from '@/shared/lib/arenaApi';
import { arenaQueryKeys } from '@/shared/hooks/useArenaGroup';
import { useRepoBranches } from '@/shared/hooks/useRepoBranches';
import { getValidProjectRepoDefaults } from '@/shared/hooks/useProjectRepoDefaults';
import BranchSelector from '@/shared/components/tasks/BranchSelector';
import { defineModal } from '@/shared/lib/modals';

interface CreateArenaDialogProps {
  projectId: string;
  issueId: string;
  /** Suggested initial prompt (e.g. issue title + description). */
  initialPrompt?: string;
  /** Hard ceiling for attempts (project-level config; defaults to 6). */
  maxAttempts?: number;
}

export type CreateArenaDialogResult =
  | { kind: 'created'; groupId: string }
  | { kind: 'canceled' };

interface AttemptDraft {
  id: string;
  executor: BaseCodingAgent;
  variant: string;
}

const ARENA_MIN_ATTEMPTS = 2;
const ARENA_MAX_ATTEMPTS_DEFAULT = 6;
const EXECUTOR_OPTIONS = Object.values(BaseCodingAgent);

let attemptIdCounter = 0;
function nextAttemptId(): string {
  attemptIdCounter += 1;
  return `att-${attemptIdCounter}`;
}

function defaultDraft(executor: BaseCodingAgent): AttemptDraft {
  return {
    id: nextAttemptId(),
    executor,
    variant: '',
  };
}

function getRepoDisplayName(repo: Repo): string {
  return repo.display_name || repo.name;
}

function getRepoOptionLabel(repo: Repo): string {
  return `${getRepoDisplayName(repo)} - ${repo.path}`;
}

function isActiveArenaConflict(errorMessage: string): boolean {
  return errorMessage.includes('already has an active arena group');
}

const CreateArenaDialogImpl = create<CreateArenaDialogProps>(
  ({
    projectId,
    issueId,
    initialPrompt = '',
    maxAttempts: maxAttemptsProp,
  }) => {
    const modal = useModal();
    const queryClient = useQueryClient();
    const maxAttempts = Math.max(
      ARENA_MIN_ATTEMPTS,
      Math.min(
        maxAttemptsProp ?? ARENA_MAX_ATTEMPTS_DEFAULT,
        ARENA_MAX_ATTEMPTS_DEFAULT
      )
    );

    const [prompt, setPrompt] = useState(initialPrompt);
    const [mode, setMode] = useState<ArenaMode>('design');
    const [baseBranch, setBaseBranch] = useState('main');
    const [repoId, setRepoId] = useState<string | null>(null);
    const [attempts, setAttempts] = useState<AttemptDraft[]>(() => [
      defaultDraft(EXECUTOR_OPTIONS[0] as BaseCodingAgent),
      defaultDraft(
        (EXECUTOR_OPTIONS[1] as BaseCodingAgent) ??
          (EXECUTOR_OPTIONS[0] as BaseCodingAgent)
      ),
    ]);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const canceledRef = useRef(false);

    // Discover repos available for this project. We don't currently
    // filter by project membership — the user is expected to pick the
    // repo whose worktree should host these attempts.
    const { data: repos, isLoading: reposLoading } = useQuery<Repo[]>({
      queryKey: ['repoApi.list'],
      queryFn: () => repoApi.list(),
      staleTime: 60_000,
    });

    const repoIdsKey = useMemo(
      () => repos?.map((repo) => repo.id).join('|') ?? '',
      [repos]
    );
    const { data: projectRepoDefaults = [], isLoading: defaultsLoading } =
      useQuery({
        queryKey: ['projectRepoDefaults', projectId, repoIdsKey],
        queryFn: () =>
          getValidProjectRepoDefaults(
            projectId,
            new Set((repos ?? []).map((repo) => repo.id))
          ),
        enabled: !!projectId && !!repos?.length,
        staleTime: 60_000,
      });

    const selectedRepo = useMemo(
      () => repos?.find((repo) => repo.id === repoId) ?? null,
      [repos, repoId]
    );
    const selectedProjectDefault = useMemo(
      () =>
        selectedRepo
          ? projectRepoDefaults.find(
              (defaultRepo) => defaultRepo.repo_id === selectedRepo.id
            )
          : undefined,
      [projectRepoDefaults, selectedRepo]
    );

    const {
      data: branches = [],
      isLoading: branchesLoading,
      isError: branchesError,
    } = useRepoBranches(repoId, {
      enabled: !!repoId,
    });

    useEffect(() => {
      if (repoId || !repos || repos.length === 0 || defaultsLoading) {
        return;
      }

      const preferredRepoId = projectRepoDefaults[0]?.repo_id;
      const nextRepo =
        repos.find((repo) => repo.id === preferredRepoId) ?? repos[0];
      const preferredBranch =
        projectRepoDefaults.find(
          (defaultRepo) => defaultRepo.repo_id === nextRepo.id
        )?.target_branch || nextRepo.default_target_branch;

      setRepoId(nextRepo.id);
      if (preferredBranch) {
        setBaseBranch(preferredBranch);
      }
    }, [repos, repoId, defaultsLoading, projectRepoDefaults]);

    useEffect(() => {
      if (!selectedRepo) return;

      const preferredBranch =
        selectedProjectDefault?.target_branch ||
        selectedRepo.default_target_branch;
      const currentBranch = branches.find((branch) => branch.is_current)?.name;
      const fallbackBranch =
        preferredBranch || currentBranch || branches[0]?.name;

      if (!baseBranch.trim() && fallbackBranch) {
        setBaseBranch(fallbackBranch);
        return;
      }

      if (
        branches.length > 0 &&
        !branches.some((branch) => branch.name === baseBranch) &&
        fallbackBranch
      ) {
        setBaseBranch(fallbackBranch);
      }
    }, [baseBranch, branches, selectedProjectDefault, selectedRepo]);

    const canAddAttempt = attempts.length < maxAttempts;
    const canRemoveAttempt = attempts.length > ARENA_MIN_ATTEMPTS;

    const handleClose = () => {
      canceledRef.current = true;
      modal.resolve({ kind: 'canceled' } satisfies CreateArenaDialogResult);
      modal.hide();
    };

    const handleOpenChange = (open: boolean) => {
      if (!open) {
        handleClose();
      }
    };

    const handleRepoChange = (nextRepoId: string) => {
      const nextRepo = repos?.find((repo) => repo.id === nextRepoId);
      const preferredBranch =
        projectRepoDefaults.find(
          (defaultRepo) => defaultRepo.repo_id === nextRepoId
        )?.target_branch || nextRepo?.default_target_branch;

      setRepoId(nextRepoId || null);
      setBaseBranch(preferredBranch ?? '');
      setError(null);
    };

    const handleAddAttempt = () => {
      if (!canAddAttempt) return;
      setAttempts((prev) => [
        ...prev,
        defaultDraft(EXECUTOR_OPTIONS[0] as BaseCodingAgent),
      ]);
    };

    const handleRemoveAttempt = (id: string) => {
      if (!canRemoveAttempt) return;
      setAttempts((prev) => prev.filter((a) => a.id !== id));
    };

    const handleAttemptChange = (
      id: string,
      patch: Partial<Omit<AttemptDraft, 'id'>>
    ) => {
      setAttempts((prev) =>
        prev.map((a) => (a.id === id ? { ...a, ...patch } : a))
      );
    };

    const validationError = useMemo<string | null>(() => {
      if (!prompt.trim()) return 'Prompt is required.';
      if (!baseBranch.trim()) return 'Base branch is required.';
      if (!repoId) return 'Pick a repository.';
      if (attempts.length < ARENA_MIN_ATTEMPTS)
        return `At least ${ARENA_MIN_ATTEMPTS} attempts are required.`;
      if (attempts.length > maxAttempts)
        return `At most ${maxAttempts} attempts are allowed.`;
      return null;
    }, [prompt, baseBranch, repoId, attempts.length, maxAttempts]);

    const handleSubmit = async () => {
      if (validationError) {
        setError(validationError);
        return;
      }
      if (!repoId) return;
      canceledRef.current = false;
      setSubmitting(true);
      setError(null);

      const payload: CreateArenaRequest = {
        project_id: projectId,
        base_branch: baseBranch.trim(),
        prompt: prompt.trim(),
        mode,
        repos: [{ repo_id: repoId, target_branch: baseBranch.trim() }],
        attempts: attempts.map((attempt) => ({
          executor_config: {
            executor: attempt.executor,
            variant: attempt.variant.trim() || null,
            model_id: null,
            agent_id: null,
            reasoning_id: null,
            permission_policy: null,
          },
          name: null,
          prompt: null,
        })),
      };

      try {
        const group = await arenaApi.create(issueId, payload);
        if (canceledRef.current) return;
        queryClient.setQueryData(arenaQueryKeys.group(group.id), group);
        queryClient.setQueryData(arenaQueryKeys.activeForIssue(issueId), group);
        modal.resolve({
          kind: 'created',
          groupId: group.id,
        } satisfies CreateArenaDialogResult);
        modal.hide();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to create arena';
        if (isActiveArenaConflict(message)) {
          const activeGroup = await arenaApi
            .getActiveForIssue(issueId)
            .catch(() => null);
          if (canceledRef.current) return;
          if (activeGroup) {
            queryClient.setQueryData(
              arenaQueryKeys.group(activeGroup.id),
              activeGroup
            );
            queryClient.setQueryData(
              arenaQueryKeys.activeForIssue(issueId),
              activeGroup
            );
            modal.resolve({
              kind: 'created',
              groupId: activeGroup.id,
            } satisfies CreateArenaDialogResult);
            modal.hide();
            return;
          }
        }

        if (canceledRef.current) return;
        setError(message);
        setSubmitting(false);
      }
    };

    const dialogTitle =
      mode === 'design'
        ? `Start Design Arena / ${attempts.length} attempts`
        : `Start Implementation Arena / ${attempts.length} attempts`;
    const dialogDescription =
      mode === 'design'
        ? 'Compare multiple agents as design conversations. Workspaces are isolated, and commits are not created by default.'
        : 'Run multiple implementation attempts and compare their code changes.';

    return (
      <Dialog open={modal.visible} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>{dialogDescription}</DialogDescription>
          </DialogHeader>

          <div className="space-y-base py-half">
            <div className="space-y-half">
              <label
                htmlFor="arena-prompt"
                className="text-xs font-medium text-low"
              >
                Prompt
              </label>
              <Textarea
                id="arena-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe what each agent should do…"
                rows={4}
                className="font-ibm-plex-mono"
              />
            </div>

            <div className="space-y-half">
              <span className="text-xs font-medium text-low">Mode</span>
              <div className="inline-flex rounded border border-zinc-200 bg-secondary p-0.5 dark:border-zinc-800">
                <button
                  type="button"
                  className={`rounded px-3 py-1.5 text-xs ${
                    mode === 'design'
                      ? 'bg-primary text-high shadow-sm'
                      : 'text-low hover:text-normal'
                  }`}
                  aria-pressed={mode === 'design'}
                  onClick={() => setMode('design')}
                >
                  Design
                </button>
                <button
                  type="button"
                  className={`rounded px-3 py-1.5 text-xs ${
                    mode === 'implementation'
                      ? 'bg-primary text-high shadow-sm'
                      : 'text-low hover:text-normal'
                  }`}
                  aria-pressed={mode === 'implementation'}
                  onClick={() => setMode('implementation')}
                >
                  Implementation
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-half">
              <div className="space-y-half">
                <label
                  htmlFor="arena-repo"
                  className="text-xs font-medium text-low"
                >
                  Repository
                </label>
                <select
                  id="arena-repo"
                  value={repoId ?? ''}
                  onChange={(e) => handleRepoChange(e.target.value)}
                  disabled={reposLoading}
                  className="h-10 w-full rounded border bg-secondary px-2 text-sm"
                >
                  {!repos || repos.length === 0 ? (
                    <option value="">
                      {reposLoading ? 'Loading…' : 'No repositories'}
                    </option>
                  ) : (
                    repos.map((repo) => (
                      <option key={repo.id} value={repo.id}>
                        {getRepoOptionLabel(repo)}
                      </option>
                    ))
                  )}
                </select>
                {selectedRepo ? (
                  <p
                    className="truncate text-[11px] text-low"
                    title={selectedRepo.path}
                  >
                    Loaded from local repositories / {selectedRepo.path}
                  </p>
                ) : null}
              </div>

              <div className="space-y-half">
                <label className="text-xs font-medium text-low">
                  Base branch
                </label>
                <BranchSelector
                  branches={branches}
                  selectedBranch={baseBranch || null}
                  onBranchSelect={(branch) => {
                    setBaseBranch(branch);
                    setError(null);
                  }}
                  placeholder={
                    branchesLoading
                      ? 'Loading branches...'
                      : branchesError
                        ? 'Failed to load branches'
                        : 'Select branch'
                  }
                />
              </div>
            </div>

            <div className="space-y-half">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-low">Attempts</span>
                <Button
                  size="xs"
                  variant="outline"
                  type="button"
                  disabled={!canAddAttempt}
                  onClick={handleAddAttempt}
                >
                  Add attempt ({attempts.length}/{maxAttempts})
                </Button>
              </div>

              <ul className="space-y-half">
                {attempts.map((attempt, idx) => (
                  <li
                    key={attempt.id}
                    className="grid grid-cols-[auto_1fr_1fr_auto] items-center gap-half rounded border border-zinc-200 bg-secondary px-half py-half dark:border-zinc-800"
                  >
                    <span className="w-6 text-center text-xs text-low">
                      #{idx + 1}
                    </span>
                    <select
                      value={attempt.executor}
                      onChange={(e) =>
                        handleAttemptChange(attempt.id, {
                          executor: e.target.value as BaseCodingAgent,
                        })
                      }
                      className="h-9 rounded border bg-primary px-2 text-sm"
                      aria-label={`Attempt ${idx + 1} executor`}
                    >
                      {EXECUTOR_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                    <Input
                      value={attempt.variant}
                      onChange={(e) =>
                        handleAttemptChange(attempt.id, {
                          variant: e.target.value,
                        })
                      }
                      placeholder="variant (optional)"
                      aria-label={`Attempt ${idx + 1} variant`}
                    />
                    <Button
                      size="xs"
                      variant="ghost"
                      type="button"
                      onClick={() => handleRemoveAttempt(attempt.id)}
                      disabled={!canRemoveAttempt}
                      aria-label={`Remove attempt ${idx + 1}`}
                    >
                      ×
                    </Button>
                  </li>
                ))}
              </ul>
            </div>

            {error ? (
              <p className="text-xs text-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" type="button" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={submitting || !!validationError}
            >
              {submitting ? 'Starting...' : 'Start Arena'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
);

export const CreateArenaDialog = defineModal<
  CreateArenaDialogProps,
  CreateArenaDialogResult
>(CreateArenaDialogImpl);
