import { useState } from "react";
import {
  createFileRoute,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { requireAuthenticated } from "@remote/shared/lib/route-auth";
import { WorkspacesLanding } from "@/pages/workspaces/WorkspacesLanding";
import { RemoteWorkspacesPageShell } from "@remote/pages/RemoteWorkspacesPageShell";
import { useIsMobile } from "@/shared/hooks/useIsMobile";
import { useWorkspaceContext } from "@/shared/hooks/useWorkspaceContext";
import { useAppTranslation } from "@/i18n/useAppTranslation";
import { cn } from "@/shared/lib/utils";
import { CommandBarDialog } from "@/shared/dialogs/command-bar/CommandBarDialog";
import {
  PlusIcon,
  GitBranchIcon,
  HandIcon,
  TriangleIcon,
  PlayIcon,
  FileIcon,
  CircleIcon,
  GitPullRequestIcon,
  PushPinIcon,
  DotsThreeIcon,
  ArchiveIcon,
  ArrowLeftIcon,
} from "@phosphor-icons/react";
import { Button } from "@vibe/ui/components/Button";
import { RunningDots } from "@vibe/ui/components/RunningDots";
import {
  DegradedState,
  EmptyState,
  ErrorState,
  LoadingState,
} from "@vibe/ui/components/StateSurface";

export const Route = createFileRoute("/hosts/$hostId/workspaces")({
  beforeLoad: async ({ location }) => {
    await requireAuthenticated(location);
  },
  component: WorkspacesRouteComponent,
});

function WorkspacesRouteComponent() {
  const isMobile = useIsMobile();
  return (
    <RemoteWorkspacesPageShell>
      {isMobile ? <MobileWorkspacesList /> : <WorkspacesLanding />}
    </RemoteWorkspacesPageShell>
  );
}

function MobileWorkspacesList() {
  const { t, i18n } = useAppTranslation("common");
  const navigate = useNavigate();
  const { hostId } = useParams({ from: "/hosts/$hostId/workspaces" });
  const {
    activeWorkspaces,
    archivedWorkspaces,
    workspaceListState,
    isWorkspacesListRetrying,
    retryWorkspaces,
    selectWorkspace,
  } = useWorkspaceContext();
  const [showArchive, setShowArchive] = useState(false);
  const workspaces = showArchive ? archivedWorkspaces : activeWorkspaces;
  const canCreate =
    workspaceListState !== "loading" && workspaceListState !== "error";

  const handleSelectWorkspace = (id: string) => {
    selectWorkspace(id);
    navigate({
      to: "/hosts/$hostId/workspaces/$workspaceId",
      params: { hostId, workspaceId: id },
    });
  };

  const handleCreateWorkspace = () => {
    if (!canCreate) return;
    navigate({ to: "/hosts/$hostId/workspaces/create", params: { hostId } });
  };

  return (
    <div className="flex flex-col h-full bg-primary">
      {/* Header */}
      <div className="flex items-center justify-between px-base py-base border-b border-border">
        <h1 className="text-lg font-semibold text-high">
          {showArchive ? t("workspaces.archived") : t("workspaces.title")}
        </h1>
        <button
          type="button"
          onClick={handleCreateWorkspace}
          disabled={!canCreate}
          className={cn(
            "flex min-h-11 items-center gap-half rounded-md px-plusfifty py-half",
            "bg-brand text-on-brand text-sm font-medium",
            "transition-opacity active:opacity-80 disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <PlusIcon className="size-icon-sm" />
          {t("workspaces.newWorkspace")}
        </button>
      </div>

      {/* Workspace list */}
      <div className="flex-1 overflow-y-auto">
        {workspaceListState === "loading" ? (
          <LoadingState
            className="h-full"
            title={t("workspaces.loadingTitle", {
              defaultValue: "Loading workspaces",
            })}
          />
        ) : workspaceListState === "error" ? (
          <ErrorState
            className="h-full"
            title={t("workspaces.errorTitle", {
              defaultValue: "Workspaces could not be loaded",
            })}
            description={t("workspaces.errorDescription", {
              defaultValue: "Check the connection and try again.",
            })}
            action={
              <Button
                className="min-h-11"
                loading={isWorkspacesListRetrying}
                loadingLabel={t("workspaces.retrying", {
                  defaultValue: "Retrying workspaces",
                })}
                onClick={() => void retryWorkspaces()}
              >
                {t("buttons.retry")}
              </Button>
            }
          />
        ) : (
          <>
            {workspaceListState === "degraded" && (
              <DegradedState
                compact
                className="m-base"
                title={t("workspaces.degradedTitle", {
                  defaultValue: "Workspaces may be out of date",
                })}
                description={t("workspaces.degradedDescription", {
                  defaultValue:
                    "The last loaded workspaces remain available while the connection recovers.",
                })}
                action={
                  <Button
                    className="min-h-11"
                    loading={isWorkspacesListRetrying}
                    loadingLabel={t("workspaces.retrying", {
                      defaultValue: "Retrying workspaces",
                    })}
                    onClick={() => void retryWorkspaces()}
                  >
                    {t("buttons.retry")}
                  </Button>
                }
              />
            )}
            {workspaces.length === 0 ? (
              <EmptyState
                className="h-full"
                title={
                  showArchive
                    ? t("workspaces.noArchived")
                    : t("workspaces.emptyTitle", {
                        defaultValue: "No workspaces yet",
                      })
                }
                description={
                  showArchive
                    ? undefined
                    : t("workspaces.emptyDescription", {
                        defaultValue: "Start a workspace to run an Agent task.",
                      })
                }
                action={
                  !showArchive ? (
                    <Button
                      className="min-h-11"
                      onClick={handleCreateWorkspace}
                    >
                      {t("workspaces.newWorkspace")}
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <div className="flex flex-col">
                {workspaces.map((workspace) => {
                  const isFailed =
                    workspace.latestProcessStatus === "failed" ||
                    workspace.latestProcessStatus === "crashed" ||
                    workspace.latestProcessStatus === "audit_failed";
                  const hasChanges =
                    workspace.filesChanged !== undefined &&
                    workspace.filesChanged > 0;

                  return (
                    <div
                      key={workspace.id}
                      className={cn(
                        "group relative flex items-center gap-half px-base py-plusfifty",
                        "border-b border-border",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => handleSelectWorkspace(workspace.id)}
                        className={cn(
                          "flex min-h-11 min-w-0 flex-1 flex-col gap-half text-left",
                          "transition-colors active:bg-secondary",
                        )}
                      >
                        <span className="text-sm font-medium text-high truncate">
                          {workspace.name}
                        </span>
                        <span className="flex items-center gap-base text-xs text-low">
                          {/* Branch */}
                          {workspace.branch && (
                            <span className="flex items-center gap-half min-w-0 shrink truncate">
                              <GitBranchIcon className="size-icon-xs shrink-0" />
                              <span className="truncate">
                                {workspace.branch}
                              </span>
                            </span>
                          )}

                          {/* Status indicators */}
                          <span className="flex items-center gap-half shrink-0">
                            {/* Dev server running */}
                            {workspace.hasRunningDevServer && (
                              <PlayIcon
                                className="size-icon-xs text-brand shrink-0"
                                weight="fill"
                              />
                            )}

                            {/* Failed/killed status (only when not running) */}
                            {!workspace.isRunning && isFailed && (
                              <TriangleIcon
                                className="size-icon-xs text-error shrink-0"
                                weight="fill"
                              />
                            )}

                            {/* Running dots OR hand icon for pending approval */}
                            {workspace.isRunning &&
                              (workspace.hasPendingApproval ? (
                                <HandIcon
                                  className="size-icon-xs text-brand shrink-0"
                                  weight="fill"
                                />
                              ) : (
                                <RunningDots />
                              ))}

                            {/* Unseen activity indicator (only when not running and not failed) */}
                            {workspace.hasUnseenActivity &&
                              !workspace.isRunning &&
                              !isFailed && (
                                <CircleIcon
                                  className="size-icon-xs text-brand shrink-0"
                                  weight="fill"
                                />
                              )}

                            {/* PR status icon */}
                            {workspace.prStatus === "open" && (
                              <GitPullRequestIcon
                                className="size-icon-xs text-success shrink-0"
                                weight="fill"
                              />
                            )}
                            {workspace.prStatus === "merged" && (
                              <GitPullRequestIcon
                                className="size-icon-xs text-merged shrink-0"
                                weight="fill"
                              />
                            )}

                            {/* Pin icon */}
                            {workspace.isPinned && (
                              <PushPinIcon
                                className="size-icon-xs text-brand shrink-0"
                                weight="fill"
                              />
                            )}
                          </span>

                          {/* Elapsed time */}
                          {!workspace.isRunning &&
                            workspace.latestProcessCompletedAt && (
                              <span className="shrink-0">
                                {formatRelativeElapsed(
                                  workspace.latestProcessCompletedAt,
                                  i18n.resolvedLanguage ?? i18n.language,
                                )}
                              </span>
                            )}

                          {/* File changes */}
                          {hasChanges && (
                            <span className="shrink-0 flex items-center gap-half">
                              <FileIcon
                                className="size-icon-xs"
                                weight="fill"
                              />
                              <span>{workspace.filesChanged}</span>
                              {workspace.linesAdded !== undefined && (
                                <span className="text-success">
                                  +{workspace.linesAdded}
                                </span>
                              )}
                              {workspace.linesRemoved !== undefined && (
                                <span className="text-error">
                                  -{workspace.linesRemoved}
                                </span>
                              )}
                            </span>
                          )}
                        </span>
                      </button>
                      {/* Workspace actions menu */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          CommandBarDialog.show({
                            page: "workspaceActions",
                            workspaceId: workspace.id,
                          });
                        }}
                        className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-sm text-low hover:bg-tertiary hover:text-normal active:bg-tertiary"
                        aria-label={t("workspaces.actionsFor", {
                          name: workspace.name,
                          defaultValue: "Actions for {{name}}",
                        })}
                      >
                        <DotsThreeIcon className="size-5" weight="bold" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Fixed footer toggle */}
      <div className="border-t border-border p-base">
        <button
          type="button"
          onClick={() => setShowArchive(!showArchive)}
          className="flex min-h-11 w-full items-center gap-base text-sm text-low transition-colors duration-100 hover:text-normal"
        >
          {showArchive ? (
            <>
              <ArrowLeftIcon className="size-icon-xs" />
              <span>{t("workspaces.backToActive")}</span>
            </>
          ) : (
            <>
              <ArchiveIcon className="size-icon-xs" />
              <span>{t("workspaces.viewArchive")}</span>
              {archivedWorkspaces.length > 0 && (
                <span className="ml-auto text-xs bg-tertiary px-1.5 py-0.5 rounded">
                  {archivedWorkspaces.length}
                </span>
              )}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

const formatRelativeElapsed = (dateString: string, locale: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  if (diffSecs < 60) return formatter.format(0, "second");
  if (diffMins < 60) return formatter.format(-diffMins, "minute");
  if (diffHours < 24) return formatter.format(-diffHours, "hour");
  return formatter.format(-diffDays, "day");
};
