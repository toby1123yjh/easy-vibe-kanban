import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  ChevronDown,
  Sparkles,
  Workflow,
  X,
} from 'lucide-react';
import type { TaskSummary } from 'shared/types';
import type { Issue, ProjectStatus, Tag } from 'shared/remote-types';
import { taskExecutionLabel, taskStatusLabel } from '../model/project-kanban';

interface IssueFloatingPanelProps {
  issue: Issue;
  statuses: ProjectStatus[];
  tags: Tag[];
  selectedTagIds: Set<string>;
  tasks: TaskSummary[];
  error: string | null;
  busyAction: 'agent' | 'workflow' | 'arena' | null;
  agentUnavailableReason: string | null;
  workflowUnavailableReason: string | null;
  arenaUnavailableReason: string | null;
  relationships: ReactNode;
  comments: ReactNode;
  onClose(): void;
  onOpenTask(task: TaskSummary): void;
  getTaskUnavailableReason(task: TaskSummary): string | null;
  onCreateAgent(): void;
  onCreateWorkflow(): void;
  onCreateArena(): void;
  onUpdateDescription(description: string | null): void;
  onUpdateStatus(statusId: string): void;
  onToggleTag(tagId: string): void;
}

function TaskRow({
  task,
  onOpen,
  unavailableReason,
}: {
  task: TaskSummary;
  onOpen(): void;
  unavailableReason: string | null;
}) {
  return (
    <button
      type="button"
      className="vk-issue-task-row"
      aria-disabled={unavailableReason ? true : undefined}
      title={unavailableReason ?? undefined}
      onClick={() => {
        if (!unavailableReason) onOpen();
      }}
    >
      <span className="vk-issue-task-row__copy">
        <strong>{task.title}</strong>
        <small>{taskExecutionLabel(task.execution_kind)}</small>
      </span>
      <span className="vk-issue-task-row__status" data-status={task.status}>
        {taskStatusLabel(task.status)}
      </span>
      <ArrowRight aria-hidden="true" size={16} />
    </button>
  );
}

export function IssueFloatingPanel({
  issue,
  statuses,
  tags,
  selectedTagIds,
  tasks,
  error,
  busyAction,
  agentUnavailableReason,
  workflowUnavailableReason,
  arenaUnavailableReason,
  relationships,
  comments,
  onClose,
  onOpenTask,
  getTaskUnavailableReason,
  onCreateAgent,
  onCreateWorkflow,
  onCreateArena,
  onUpdateDescription,
  onUpdateStatus,
  onToggleTag,
}: IssueFloatingPanelProps) {
  const [informationOpen, setInformationOpen] = useState(false);
  const [description, setDescription] = useState(issue.description ?? '');

  useEffect(() => {
    setInformationOpen(false);
    setDescription(issue.description ?? '');
  }, [issue.id, issue.description]);

  return (
    <div className="vk-issue-panel__layout">
      <header className="vk-issue-panel__header">
        <button
          type="button"
          className="vk-issue-panel__back"
          onClick={onClose}
          aria-label="Back to board"
        >
          <ArrowLeft aria-hidden="true" size={18} />
        </button>
        <span>{issue.simple_id}</span>
        <button type="button" onClick={onClose} aria-label="Close issue">
          <X aria-hidden="true" size={18} />
        </button>
      </header>

      <div className="vk-issue-panel__body">
        <h1>{issue.title}</h1>

        <section
          className="vk-issue-panel__tasks"
          aria-labelledby="issue-tasks"
        >
          <div className="vk-issue-panel__section-heading">
            <h2 id="issue-tasks">Tasks</h2>
            <span>{tasks.length}</span>
          </div>
          {tasks.length === 0 ? (
            <p className="vk-issue-panel__empty">
              No execution tasks have been started for this issue.
            </p>
          ) : (
            <div className="vk-issue-task-list">
              {tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onOpen={() => onOpenTask(task)}
                  unavailableReason={getTaskUnavailableReason(task)}
                />
              ))}
            </div>
          )}
        </section>

        <section
          className="vk-issue-panel__execute"
          aria-labelledby="new-execution"
        >
          <h2 id="new-execution">New execution</h2>
          <div>
            <button
              type="button"
              onClick={() => {
                if (!agentUnavailableReason) onCreateAgent();
              }}
              disabled={busyAction === 'agent'}
              aria-disabled={agentUnavailableReason ? true : undefined}
              title={agentUnavailableReason ?? undefined}
            >
              <Bot aria-hidden="true" size={17} />
              <span>Single agent</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (!workflowUnavailableReason) onCreateWorkflow();
              }}
              disabled={busyAction === 'workflow'}
              aria-disabled={workflowUnavailableReason ? true : undefined}
              title={workflowUnavailableReason ?? undefined}
            >
              <Workflow aria-hidden="true" size={17} />
              <span>Workflow</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (!arenaUnavailableReason) onCreateArena();
              }}
              disabled={busyAction === 'arena'}
              aria-disabled={arenaUnavailableReason ? true : undefined}
              title={arenaUnavailableReason ?? undefined}
            >
              <Sparkles aria-hidden="true" size={17} />
              <span>Arena</span>
            </button>
          </div>
          {agentUnavailableReason ||
          workflowUnavailableReason ||
          arenaUnavailableReason ? (
            <small className="vk-issue-panel__capability-note">
              {[
                agentUnavailableReason,
                workflowUnavailableReason,
                arenaUnavailableReason,
              ]
                .filter((reason): reason is string => Boolean(reason))
                .join(' ')}
            </small>
          ) : null}
        </section>

        {error ? (
          <p className="vk-issue-panel__error" role="alert">
            {error}
          </p>
        ) : null}

        <section className="vk-issue-information">
          <button
            type="button"
            className="vk-issue-information__trigger"
            aria-expanded={informationOpen}
            aria-controls="issue-information-body"
            onClick={() => setInformationOpen((open) => !open)}
          >
            <span>Issue information</span>
            <ChevronDown aria-hidden="true" size={17} />
          </button>
          {informationOpen ? (
            <div
              id="issue-information-body"
              className="vk-issue-information__body"
            >
              <label>
                <span>Status</span>
                <select
                  value={issue.status_id}
                  onChange={(event) => onUpdateStatus(event.target.value)}
                >
                  {statuses.map((status) => (
                    <option key={status.id} value={status.id}>
                      {status.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Description</span>
                <textarea
                  value={description}
                  rows={5}
                  placeholder="Add a description"
                  onChange={(event) => setDescription(event.target.value)}
                  onBlur={() => {
                    const next = description.trim() || null;
                    if (next !== issue.description) onUpdateDescription(next);
                  }}
                />
              </label>

              <fieldset>
                <legend>Tags</legend>
                <div className="vk-issue-information__tags">
                  {tags.length === 0 ? (
                    <span>No project tags</span>
                  ) : (
                    tags.map((tag) => (
                      <button
                        key={tag.id}
                        type="button"
                        aria-pressed={selectedTagIds.has(tag.id)}
                        onClick={() => onToggleTag(tag.id)}
                      >
                        {tag.name}
                      </button>
                    ))
                  )}
                </div>
              </fieldset>

              <div className="vk-issue-information__legacy-section">
                {relationships}
              </div>
              <div className="vk-issue-information__legacy-section">
                {comments}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
