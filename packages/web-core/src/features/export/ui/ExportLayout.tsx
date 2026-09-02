import { useState } from 'react';
import {
  ExportChooseProjects,
  type ExportOrganization,
  type ExportProject,
} from './ExportChooseProjects';
import { ExportDownload, type ExportRequest } from './ExportDownload';

interface ExportLayoutProps {
  exportFn: (request: ExportRequest) => Promise<Response>;
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
}

interface ExportData {
  orgId: string;
  projectIds: string[];
  includeAttachments: boolean;
}

export function ExportLayout({
  exportFn,
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
}: ExportLayoutProps) {
  const [exportData, setExportData] = useState<ExportData | null>(null);

  const handleChooseProjectsContinue = (
    orgId: string,
    projectIds: string[],
    includeAttachments: boolean
  ) => {
    setExportData({
      orgId,
      projectIds,
      includeAttachments,
    });
  };

  if (exportData) {
    return (
      <ExportDownload
        orgId={exportData.orgId}
        projectIds={exportData.projectIds}
        includeAttachments={exportData.includeAttachments}
        onExportMore={() => setExportData(null)}
        exportFn={exportFn}
      />
    );
  }

  return (
    <ExportChooseProjects
      organizations={organizations}
      orgsLoading={orgsLoading}
      orgsError={orgsError}
      onRetryOrganizations={onRetryOrganizations}
      projects={projects}
      projectsLoading={projectsLoading}
      projectsError={projectsError}
      onRetryProjects={onRetryProjects}
      selectedOrgId={selectedOrgId}
      onOrgChange={onOrgChange}
      onContinue={handleChooseProjectsContinue}
    />
  );
}
