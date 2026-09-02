import { useState, useEffect, useMemo } from 'react';
import { CheckCircleIcon, CircleIcon, ImageIcon } from '@phosphor-icons/react';
import { Button } from '@vibe/ui/components/Button';
import {
  DegradedState,
  EmptyState,
  ErrorState,
  LoadingState,
} from '@vibe/ui/components/StateSurface';
import {
  projectExportSelectionState,
  reconcileExportProjectSelection,
  type ExportProjectSelection,
} from '@/features/utility/model/utilityState';

export interface ExportOrganization {
  id: string;
  name: string;
}

export interface ExportProject {
  id: string;
  name: string;
}

interface ExportChooseProjectsProps {
  organizations: ExportOrganization[];
  orgsLoading: boolean;
  orgsError: unknown;
  onRetryOrganizations: () => void;
  projects: ExportProject[];
  projectsLoading: boolean;
  projectsError: unknown;
  onRetryProjects: () => void;
  selectedOrgId: string | null;
  onOrgChange: (orgId: string) => void;
  onContinue: (
    orgId: string,
    projectIds: string[],
    includeAttachments: boolean
  ) => void;
}

export function ExportChooseProjects({
  organizations,
  orgsLoading,
  orgsError,
  onRetryOrganizations,
  projects,
  projectsLoading,
  projectsError,
  onRetryProjects,
  selectedOrgId,
  onOrgChange,
  onContinue,
}: ExportChooseProjectsProps) {
  const [projectSelection, setProjectSelection] =
    useState<ExportProjectSelection | null>(null);
  const [includeAttachments, setIncludeAttachments] = useState(true);

  const selectionState = projectExportSelectionState({
    organizationCount: organizations.length,
    organizationsLoading: orgsLoading,
    organizationsError: orgsError,
    selectedOrganizationId: selectedOrgId,
    projectCount: projects.length,
    projectsLoading,
    projectsError,
  });

  // Select all on first load for an organization. Same-owner refreshes retain
  // the user's choices, and a degraded refresh never clears cached selection.
  useEffect(() => {
    if (selectionState !== 'ready' || !selectedOrgId) return;
    setProjectSelection((previous) =>
      reconcileExportProjectSelection(
        previous,
        selectedOrgId,
        projects.map((project) => project.id)
      )
    );
  }, [projects, selectedOrgId, selectionState]);

  const selectedProjectIds = useMemo(
    () =>
      projectSelection?.organizationId === selectedOrgId
        ? new Set(projectSelection.projectIds)
        : new Set<string>(),
    [projectSelection, selectedOrgId]
  );

  const updateSelectedProjectIds = (
    update: (previous: Set<string>) => Set<string>
  ) => {
    if (!selectedOrgId) return;
    setProjectSelection((previous) => ({
      organizationId: selectedOrgId,
      projectIds: Array.from(
        update(
          previous?.organizationId === selectedOrgId
            ? new Set(previous.projectIds)
            : new Set()
        )
      ),
    }));
  };

  const handleToggleProject = (projectId: string) => {
    updateSelectedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedProjectIds.size === projects.length) {
      updateSelectedProjectIds(() => new Set());
    } else {
      updateSelectedProjectIds(() => new Set(projects.map((p) => p.id)));
    }
  };

  const handleContinue = () => {
    if (
      selectionState === 'ready' &&
      selectedOrgId &&
      selectedProjectIds.size > 0
    ) {
      onContinue(
        selectedOrgId,
        Array.from(selectedProjectIds),
        includeAttachments
      );
    }
  };

  const retryFailedSource = () => {
    if (orgsError) onRetryOrganizations();
    if (projectsError) onRetryProjects();
  };

  return (
    <div className="p-double space-y-double">
      <div className="space-y-base">
        <h2 className="text-lg font-semibold text-high">Export projects</h2>
      </div>

      {organizations.length > 1 && (
        <div className="space-y-half">
          <label className="text-sm font-medium text-high">Organization</label>
          <select
            value={selectedOrgId ?? ''}
            onChange={(e) => onOrgChange(e.target.value)}
            className="w-full rounded-sm border border-border bg-primary px-base py-half text-sm text-high"
          >
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {selectionState === 'loading' ? (
        <LoadingState compact title="Loading export data…" />
      ) : selectionState === 'error' ? (
        <ErrorState
          compact
          title="Export data could not be loaded"
          description="Organizations and projects must load successfully before an export can start."
          action={
            <Button variant="outline" onClick={retryFailedSource}>
              Retry
            </Button>
          }
        />
      ) : selectionState === 'empty' ? (
        <EmptyState
          compact
          title={
            organizations.length === 0
              ? 'No organizations available'
              : 'No projects available'
          }
          description={
            organizations.length === 0
              ? 'Join or create an organization before exporting cloud data.'
              : 'This organization has no projects to export.'
          }
        />
      ) : (
        <div className="space-y-half">
          {selectionState === 'degraded' && (
            <DegradedState
              compact
              title="Export choices may be out of date"
              description="Cached organizations and projects remain visible, but export is paused until they refresh."
              action={
                <Button variant="outline" onClick={retryFailedSource}>
                  Retry
                </Button>
              }
            />
          )}
          <div className="flex items-center justify-between">
            <span className="text-sm text-normal">
              {selectedProjectIds.size} of {projects.length} selected
            </span>
            <button
              onClick={handleSelectAll}
              className="text-sm text-brand hover:text-brand/80"
            >
              {selectedProjectIds.size === projects.length
                ? 'Deselect all'
                : 'Select all'}
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto rounded-sm border border-border divide-y divide-border">
            {projects.map((project) => {
              const isSelected = selectedProjectIds.has(project.id);
              return (
                <button
                  key={project.id}
                  onClick={() => handleToggleProject(project.id)}
                  className="w-full flex items-center gap-base px-base py-half text-sm text-left hover:bg-primary transition-colors"
                >
                  {isSelected ? (
                    <CheckCircleIcon
                      className="size-icon-sm text-brand shrink-0"
                      weight="fill"
                    />
                  ) : (
                    <CircleIcon className="size-icon-sm text-low shrink-0" />
                  )}
                  <span className={isSelected ? 'text-high' : 'text-normal'}>
                    {project.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <label className="flex items-start gap-base cursor-pointer">
        <input
          type="checkbox"
          checked={includeAttachments}
          onChange={(e) => setIncludeAttachments(e.target.checked)}
          className="mt-0.5 rounded border-border"
        />
        <div className="space-y-half">
          <div className="flex items-center gap-half">
            <ImageIcon className="size-icon-sm text-normal" />
            <span className="text-sm font-medium text-high">
              Include attachments
            </span>
          </div>
          <p className="text-xs text-low">Include files attached to issues.</p>
        </div>
      </label>

      <button
        type="button"
        onClick={handleContinue}
        disabled={selectionState !== 'ready' || selectedProjectIds.size === 0}
        className="w-full rounded-sm bg-brand px-base py-half text-sm font-medium text-white hover:bg-brand/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Export
      </button>
    </div>
  );
}
