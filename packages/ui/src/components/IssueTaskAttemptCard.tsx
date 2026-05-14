import {
  GitBranch,
  MessageSquare,
  MoreHorizontal,
  Play,
  Trash2,
  Unlink,
  Workflow,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./DropdownMenu";

export type IssueTaskAttemptKind = "single_agent" | "workflow";
export type IssueTaskAttemptStatusTone =
  | "draft"
  | "running"
  | "waiting"
  | "succeeded"
  | "failed"
  | "canceled"
  | "neutral";

export interface IssueTaskAttemptCardData {
  id: string;
  kind: IssueTaskAttemptKind;
  title: string;
  subtitle: string;
  statusLabel: string;
  statusTone: IssueTaskAttemptStatusTone;
  updatedAt: string;
  primaryActionLabel: string;
  filesChanged?: number;
  linesAdded?: number;
  linesRemoved?: number;
}

export interface IssueTaskAttemptCardProps {
  attempt: IssueTaskAttemptCardData;
  onOpen?: () => void;
  onRun?: () => void;
  onUnlink?: () => void;
  onDelete?: () => void;
}

const toneClasses: Record<IssueTaskAttemptStatusTone, string> = {
  draft: "bg-secondary text-low",
  running: "bg-brand/10 text-brand",
  waiting: "bg-warning/10 text-warning",
  succeeded: "bg-success/10 text-success",
  failed: "bg-error/10 text-error",
  canceled: "bg-secondary text-low",
  neutral: "bg-secondary text-low",
};

export function IssueTaskAttemptCard({
  attempt,
  onOpen,
  onRun,
  onUnlink,
  onDelete,
}: IssueTaskAttemptCardProps) {
  const { t } = useTranslation("common");
  const Icon = attempt.kind === "workflow" ? Workflow : MessageSquare;
  const hasStats =
    (attempt.filesChanged ?? 0) > 0 ||
    (attempt.linesAdded ?? 0) > 0 ||
    (attempt.linesRemoved ?? 0) > 0;

  return (
    <div
      data-testid={`task-attempt-${attempt.id}`}
      className="flex flex-col gap-half rounded-sm bg-panel p-base transition-colors hover:bg-secondary/70"
    >
      <div className="flex items-center justify-between gap-base">
        <div className="flex min-w-0 items-center gap-half">
          <Icon className="h-4 w-4 shrink-0 text-brand" />
          <span className="truncate text-sm text-high">{attempt.title}</span>
        </div>
        <div className="flex shrink-0 items-center gap-half">
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-xs font-medium",
              toneClasses[attempt.statusTone],
            )}
          >
            {attempt.statusLabel}
          </span>
          {(onUnlink || onDelete) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  onClick={(event) => event.stopPropagation()}
                  className="rounded p-0.5 text-low hover:bg-secondary hover:text-high"
                  aria-label={t("workspaces.more")}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onUnlink && (
                  <DropdownMenuItem onClick={onUnlink}>
                    <Unlink className="h-3.5 w-3.5" />
                    {t("workspaces.unlinkFromIssue")}
                  </DropdownMenuItem>
                )}
                {onDelete && (
                  <DropdownMenuItem
                    onClick={onDelete}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t("workspaces.deleteWorkspace")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-base">
        <div className="min-w-0 text-xs text-low">
          <span className="truncate">{attempt.subtitle}</span>
          {hasStats && (
            <span className="ml-half whitespace-nowrap">
              {attempt.filesChanged ?? 0} files
              {(attempt.linesAdded ?? 0) > 0 && (
                <span className="ml-half text-success">
                  +{attempt.linesAdded}
                </span>
              )}
              {(attempt.linesRemoved ?? 0) > 0 && (
                <span className="ml-half text-error">
                  -{attempt.linesRemoved}
                </span>
              )}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-half">
          {onRun && (
            <button
              type="button"
              onClick={onRun}
              className="rounded-sm border border-secondary bg-primary p-half text-low transition-colors hover:text-high"
              aria-label="Run workflow attempt"
            >
              <Play className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onOpen}
            disabled={!onOpen}
            className="inline-flex h-8 items-center gap-half rounded-sm bg-brand-secondary px-base text-xs font-medium text-on-brand transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            <GitBranch className="h-3.5 w-3.5" />
            <span>{attempt.primaryActionLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
