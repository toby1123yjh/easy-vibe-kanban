import { useCallback, useEffect, useMemo } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useQueries } from "@tanstack/react-query";
import { Button } from "@vibe/ui/components/Button";
import {
  DegradedState,
  EmptyState,
  ErrorState,
  LoadingState,
} from "@vibe/ui/components/StateSurface";
import type { Project } from "shared/remote-types";
import type { OrganizationWithRole } from "shared/types";
import { listOrganizationProjects } from "@remote/shared/lib/api";
import { useSettingsNavigation } from "@/shared/hooks/useSettingsNavigation";
import { useOrganizationStore } from "@/shared/stores/useOrganizationStore";
import { useUserOrganizations } from "@/shared/hooks/useUserOrganizations";
import { sortProjectsByOrder } from "@/shared/lib/projectOrder";
import { useAuth } from "@/shared/hooks/auth/useAuth";
import { useIsMobile } from "@/shared/hooks/useIsMobile";
import {
  resolveRelayNavigationHostId,
  useRelayAppBarHosts,
} from "@remote/shared/hooks/useRelayAppBarHosts";

type OrganizationWithProjects = {
  organization: OrganizationWithRole;
  projects: Project[];
  projectsLoading: boolean;
  projectsFetching: boolean;
  projectsError: unknown;
  retryProjects(): void;
};

function getHostInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "??";
  const words = trimmed.split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

export default function HomePage() {
  const navigate = useNavigate();
  const { openSettings } = useSettingsNavigation();
  const search = useSearch({ from: "/" });
  const setSelectedOrgId = useOrganizationStore((s) => s.setSelectedOrgId);
  const {
    data: orgsResponse,
    isLoading: orgsLoading,
    isFetching: orgsFetching,
    error: orgsError,
    refetch: refetchOrganizations,
  } = useUserOrganizations();
  const organizations = orgsResponse?.organizations ?? [];
  const { isSignedIn } = useAuth();
  const { hosts } = useRelayAppBarHosts(isSignedIn);
  const isMobile = useIsMobile();
  const preferredHostId = useMemo(
    () => resolveRelayNavigationHostId(hosts),
    [hosts],
  );

  const openRelaySettings = useCallback(
    (hostId?: string) => {
      openSettings("relay", { hostId });
    },
    [openSettings],
  );

  useEffect(() => {
    const legacyOrgId = search.legacyOrgSettingsOrgId;
    if (!legacyOrgId) {
      return;
    }

    setSelectedOrgId(legacyOrgId);
    openSettings("organizations", { replace: true });
  }, [openSettings, search.legacyOrgSettingsOrgId, setSelectedOrgId]);

  const projectQueries = useQueries({
    queries: organizations.map((organization) => ({
      queryKey: ["remote-home", "organization-projects", organization.id],
      queryFn: () => listOrganizationProjects(organization.id),
      staleTime: 5 * 60 * 1000,
    })),
  });

  const items: OrganizationWithProjects[] = organizations.map(
    (organization, index) => {
      const projectQuery = projectQueries[index];
      return {
        organization,
        projects: sortProjectsByOrder(projectQuery?.data ?? []),
        projectsLoading: projectQuery?.isLoading ?? false,
        projectsFetching: projectQuery?.isFetching ?? false,
        projectsError: projectQuery?.error ?? null,
        retryProjects: () => {
          void projectQuery?.refetch();
        },
      };
    },
  );

  if (orgsLoading) {
    return (
      <LoadingState
        className="h-full"
        title="Loading organizations"
        description="Checking the organizations available to your account."
      />
    );
  }

  if (orgsError && !orgsResponse) {
    return (
      <ErrorState
        className="h-full"
        title="Unable to load organizations"
        description={
          orgsError instanceof Error
            ? orgsError.message
            : "The organization list could not be loaded."
        }
        action={
          <Button
            className="min-h-11 sm:min-h-8"
            loading={orgsFetching}
            loadingLabel="Retrying organizations"
            onClick={() => {
              void refetchOrganizations();
            }}
          >
            Try again
          </Button>
        }
      />
    );
  }

  const organizationCount = items.length;
  const totalProjectCount = items.reduce(
    (count, item) => count + item.projects.length,
    0,
  );
  const hasCompleteProjectCount = items.every(
    (item) => !item.projectsLoading && !item.projectsError,
  );

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto w-full max-w-6xl px-base py-base sm:px-double sm:py-double">
        {isMobile && isSignedIn && (
          <section className="mb-double">
            <h2 className="text-lg font-semibold text-high">Your Hosts</h2>
            {hosts.length === 0 ? (
              <div className="mt-base rounded-sm border border-border bg-secondary p-base text-center">
                <p className="text-sm text-low">No hosts linked yet</p>
                <button
                  type="button"
                  className="mt-base rounded-sm border border-border bg-primary px-base py-half text-sm font-medium text-normal hover:border-brand/60 hover:text-high"
                  onClick={() => {
                    openRelaySettings();
                  }}
                >
                  Link a host
                </button>
              </div>
            ) : (
              <div className="mt-base space-y-half">
                {hosts.map((host) => {
                  const isOnline = host.status === "online";
                  const isUnpaired = host.status === "unpaired";
                  const isClickable = isOnline || isUnpaired;

                  return (
                    <button
                      key={host.id}
                      type="button"
                      disabled={!isClickable}
                      className={`flex w-full items-center gap-base rounded-sm border border-border bg-primary px-base py-base text-left transition-colors ${
                        isClickable
                          ? "hover:border-high/20 hover:bg-panel"
                          : "opacity-50"
                      }`}
                      onClick={() => {
                        if (isOnline) {
                          navigate({
                            to: "/hosts/$hostId/workspaces",
                            params: { hostId: host.id },
                          });
                        } else if (isUnpaired) {
                          openRelaySettings(host.id);
                        }
                      }}
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/15 text-xs font-semibold text-brand">
                        {getHostInitials(host.name)}
                      </div>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-high">
                        {host.name}
                      </span>
                      <span
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                          isOnline
                            ? "bg-success"
                            : isUnpaired
                              ? "border border-warning bg-white"
                              : "bg-low"
                        }`}
                      />
                    </button>
                  );
                })}
                <button
                  type="button"
                  className="flex w-full items-center justify-center rounded-sm border border-dashed border-border px-base py-half text-sm text-low hover:border-brand/60 hover:text-normal"
                  onClick={() => {
                    openRelaySettings();
                  }}
                >
                  Link a host
                </button>
              </div>
            )}
          </section>
        )}

        {orgsError && (
          <DegradedState
            compact
            className="mb-double"
            title="Organizations may be out of date"
            description="The last loaded organizations remain available while refresh is unavailable."
            action={
              <Button
                className="min-h-11 sm:min-h-8"
                variant="outline"
                size="sm"
                loading={orgsFetching}
                loadingLabel="Retrying organizations"
                onClick={() => {
                  void refetchOrganizations();
                }}
              >
                Try again
              </Button>
            }
          />
        )}

        <header className="space-y-half">
          <h1 className="text-2xl font-semibold text-high">Organizations</h1>
          <p className="text-sm text-low">
            {organizationCount}{" "}
            {organizationCount === 1 ? "organization" : "organizations"}
            {hasCompleteProjectCount && (
              <>
                {" "}
                • {totalProjectCount}{" "}
                {totalProjectCount === 1 ? "project" : "projects"}
              </>
            )}
          </p>
        </header>

        {organizationCount === 0 ? (
          <EmptyState
            className="mt-double rounded-sm border border-border bg-secondary"
            title="No organizations found"
            description="Create or join an organization to start working on projects."
            action={
              <Button
                className="min-h-11 sm:min-h-8"
                variant="outline"
                onClick={() => {
                  openSettings("organizations");
                }}
              >
                Manage organizations
              </Button>
            }
          />
        ) : (
          <div className="mt-double space-y-double">
            {items.map(
              ({
                organization,
                projects,
                projectsLoading,
                projectsFetching,
                projectsError,
                retryProjects,
              }) => (
                <OrganizationSection
                  key={organization.id}
                  organization={organization}
                  projects={projects}
                  projectsLoading={projectsLoading}
                  projectsFetching={projectsFetching}
                  projectsError={projectsError}
                  retryProjects={retryProjects}
                  hostId={preferredHostId}
                  onRequireHost={openRelaySettings}
                />
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function OrganizationSection({
  organization,
  projects,
  projectsLoading,
  projectsFetching,
  projectsError,
  retryProjects,
  hostId,
  onRequireHost,
}: OrganizationWithProjects & {
  hostId: string | null;
  onRequireHost: () => void;
}) {
  return (
    <section className="space-y-base">
      <header className="flex items-center justify-between gap-base">
        <h2 className="truncate text-lg font-medium text-high">
          {organization.name}
        </h2>
        <p className="shrink-0 text-xs text-low">
          {projectsLoading
            ? "Loading projects..."
            : projectsError && projects.length === 0
              ? "Projects unavailable"
              : `${projects.length} ${projects.length === 1 ? "project" : "projects"}`}
        </p>
      </header>

      {projectsLoading ? (
        <LoadingState
          compact
          className="rounded-sm border border-border bg-primary"
          title="Loading projects"
          description={`Checking projects in ${organization.name}.`}
        />
      ) : projectsError && projects.length === 0 ? (
        <ErrorState
          compact
          title="Unable to load projects"
          description={
            projectsError instanceof Error
              ? projectsError.message
              : `Projects in ${organization.name} could not be loaded.`
          }
          action={
            <Button
              className="min-h-11 sm:min-h-8"
              variant="outline"
              size="sm"
              loading={projectsFetching}
              loadingLabel={`Retrying projects in ${organization.name}`}
              onClick={retryProjects}
            >
              Try again
            </Button>
          }
        />
      ) : projects.length === 0 ? (
        <EmptyState
          compact
          className="rounded-sm border border-border bg-primary"
          title="No projects yet"
          description={`Projects created in ${organization.name} will appear here.`}
        />
      ) : (
        <>
          {projectsError && (
            <DegradedState
              compact
              title="Projects may be out of date"
              description="The last loaded projects remain available while refresh is unavailable."
              action={
                <Button
                  className="min-h-11 sm:min-h-8"
                  variant="outline"
                  size="sm"
                  loading={projectsFetching}
                  loadingLabel={`Retrying projects in ${organization.name}`}
                  onClick={retryProjects}
                >
                  Try again
                </Button>
              }
            />
          )}
          <ul className="grid gap-base sm:grid-cols-2">
            {projects.map((project) => (
              <li key={project.id}>
                <ProjectCard
                  project={project}
                  hostId={hostId}
                  onRequireHost={onRequireHost}
                />
              </li>
            ))}
            {projects.length % 2 === 1 ? (
              <li className="hidden sm:block" aria-hidden="true">
                <ProjectCardSkeleton />
              </li>
            ) : null}
          </ul>
        </>
      )}
    </section>
  );
}

function ProjectCard({
  project,
  hostId,
  onRequireHost,
}: {
  project: Project;
  hostId: string | null;
  onRequireHost: () => void;
}) {
  const setSelectedOrgId = useOrganizationStore((s) => s.setSelectedOrgId);

  if (!hostId) {
    return (
      <button
        type="button"
        className="group flex h-[61px] w-full flex-col justify-center rounded-sm border border-border bg-primary px-base py-base text-left hover:border-brand/60 hover:bg-panel"
        onClick={onRequireHost}
      >
        <p className="text-sm font-medium text-high">{project.name}</p>
        <p className="mt-half text-xs text-low">Link a host to open project</p>
      </button>
    );
  }

  return (
    <Link
      to="/projects/$projectId"
      params={{ projectId: project.id }}
      onClick={() => {
        setSelectedOrgId(project.organization_id);
      }}
      className="group flex h-[61px] flex-col justify-center rounded-sm border border-border bg-primary px-base py-base hover:border-high/20 hover:bg-panel focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
    >
      <p className="text-sm font-medium text-high">{project.name}</p>
      <p className="mt-half text-xs text-low group-hover:text-normal">
        Open project
      </p>
    </Link>
  );
}

function ProjectCardSkeleton() {
  return (
    <div className="h-[61px] rounded-sm border border-border bg-primary animate-pulse" />
  );
}
