import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExportPage as ExportPageUI } from "@/pages/export/ExportPage";
import {
  authenticatedFetch,
  listOrganizations,
  listOrganizationProjects,
} from "@remote/shared/lib/api";
import type { ExportRequest } from "@/features/export/ui/ExportDownload";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

export default function ExportPage() {
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const organizationsQuery = useQuery({
    queryKey: ["export-organizations"],
    queryFn: listOrganizations,
    retry: false,
  });
  const organizations = useMemo(
    () =>
      (organizationsQuery.data?.organizations ?? []).map((organization) => ({
        id: organization.id,
        name: organization.name,
      })),
    [organizationsQuery.data?.organizations],
  );
  const effectiveSelectedOrgId =
    selectedOrgId &&
    organizations.some((organization) => organization.id === selectedOrgId)
      ? selectedOrgId
      : (organizations[0]?.id ?? null);

  useEffect(() => {
    if (effectiveSelectedOrgId !== selectedOrgId) {
      setSelectedOrgId(effectiveSelectedOrgId);
    }
  }, [effectiveSelectedOrgId, selectedOrgId]);

  const projectsQuery = useQuery({
    queryKey: ["export-projects", effectiveSelectedOrgId],
    queryFn: () => listOrganizationProjects(effectiveSelectedOrgId!),
    enabled: effectiveSelectedOrgId != null,
    retry: false,
  });
  const projects = useMemo(
    () =>
      (projectsQuery.data ?? []).map((project) => ({
        id: project.id,
        name: project.name,
      })),
    [projectsQuery.data],
  );

  const exportFn = useCallback(async (request: ExportRequest) => {
    return authenticatedFetch(`${API_BASE}/v1/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  }, []);

  return (
    <ExportPageUI
      exportFn={exportFn}
      organizations={organizations}
      orgsLoading={organizationsQuery.isPending}
      orgsError={organizationsQuery.error}
      onRetryOrganizations={() => void organizationsQuery.refetch()}
      projects={projects}
      projectsLoading={
        effectiveSelectedOrgId != null && projectsQuery.isPending
      }
      projectsError={projectsQuery.error}
      onRetryProjects={() => void projectsQuery.refetch()}
      selectedOrgId={effectiveSelectedOrgId}
      onOrgChange={setSelectedOrgId}
    />
  );
}
