import { create, useModal } from '@ebay/nice-modal-react';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { arenaApi, type CreateArenaRequest } from '@/shared/lib/arenaApi';
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

const CreateArenaDialogImpl = create<CreateArenaDialogProps>(
  ({ projectId, issueId, initialPrompt = '', maxAttempts: maxAttemptsProp }) => {
    const modal = useModal();
    const maxAttempts = Math.max(
      ARENA_MIN_ATTEMPTS,
      Math.min(maxAttemptsProp ?? ARENA_MAX_ATTEMPTS_DEFAULT, ARENA_MAX_ATTEMPTS_DEFAULT)
    );

    const [prompt, setPrompt] = useState(initialPrompt);
    const [baseBranch, setBaseBranch] = useState('main');
    const [repoId, setRepoId] = useState<string | null>(null);
    const [attempts, setAttempts] = useState<AttemptDraft[]>(() => [
      defaultDraft(EXECUTOR_OPTIONS[0] as BaseCodingAgent),
      defaultDraft(EXECUTOR_OPTIONS[1] as BaseCodingAgent ?? (EXECUTOR_OPTIONS[0] as BaseCodingAgent)),
    ]);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Discover repos available for this project. We don't currently
    // filter by project membership — the user is expected to pick the
    // repo whose worktree should host these attempts.
    const { data: repos, isLoading: reposLoading } = useQuery<Repo[]>({
      queryKey: ['repoApi.list'],
      queryFn: () => repoApi.list(),
      staleTime: 60_000,
    });

    // Auto-select the first repo once loaded.
    useEffect(() => {
      if (!repoId && repos && repos.length > 0) {
        setRepoId(repos[0].id);
        if (repos[0].default_target_branch) {
          setBaseBranch(repos[0].default_target_branch);
        }
      }
    }, [repos, repoId]);

    const canAddAttempt = attempts.length < maxAttempts;
    const canRemoveAttempt = attempts.length > ARENA_MIN_ATTEMPTS;

    const handleClose = () => {
      modal.resolve({ kind: 'canceled' } satisfies CreateArenaDialogResult);
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
      setSubmitting(true);
      setError(null);

      const payload: CreateArenaRequest = {
        project_id: projectId,
        base_branch: baseBranch.trim(),
        prompt: prompt.trim(),
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
        modal.resolve({
          kind: 'created',
          groupId: group.id,
        } satisfies CreateArenaDialogResult);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create arena');
        setSubmitting(false);
      }
    };

    return (
      <Dialog open={modal.visible} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Start a race · {attempts.length} attempts</DialogTitle>
            <DialogDescription>
              Run the same prompt against multiple coding agents in parallel.
              Compare results side-by-side, then promote one to merge.
            </DialogDescription>
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
                  onChange={(e) => setRepoId(e.target.value)}
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
                        {repo.display_name || repo.name}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="space-y-half">
                <label
                  htmlFor="arena-base-branch"
                  className="text-xs font-medium text-low"
                >
                  Base branch
                </label>
                <Input
                  id="arena-base-branch"
                  value={baseBranch}
                  onChange={(e) => setBaseBranch(e.target.value)}
                  placeholder="main"
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
            <Button
              variant="outline"
              type="button"
              onClick={handleClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={submitting || !!validationError}
            >
              {submitting ? 'Starting…' : 'Start race'}
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
