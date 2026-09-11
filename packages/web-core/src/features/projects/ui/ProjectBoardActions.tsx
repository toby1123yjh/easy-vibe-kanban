import { useNavigate } from '@tanstack/react-router';
import { ProjectActionsMenu } from '@/shared/components/ProjectActionsMenu';
import { useAppShellProjects } from '@/shared/hooks/useAppShellProjects';
import { useDeleteProject } from '@/shared/hooks/useDeleteProject';
import { useSettingsNavigation } from '@/shared/hooks/useSettingsNavigation';

export function ProjectBoardActions({
  projectId,
  projectName,
  hostId,
}: {
  projectId: string;
  projectName: string;
  hostId: string | null;
}) {
  const navigate = useNavigate();
  const { openSettings } = useSettingsNavigation();
  const projectsState = useAppShellProjects();
  const { deleteProject, pendingProjectId } = useDeleteProject({
    scopeKey: `board:${projectId}:${hostId ?? 'local'}`,
    enabled:
      Boolean(projectsState?.scopeKey) &&
      !(projectsState?.deployment === 'remote' && !projectsState.hostId),
    onDeleted: () => {
      void navigate({ to: '/projects', replace: true });
    },
  });
  return (
    <ProjectActionsMenu
      projectName={projectName}
      className="vk-project-actions-trigger"
      disabled={pendingProjectId !== null}
      onSettings={() => openSettings('projects', { projectId, hostId })}
      onDelete={() => void deleteProject({ id: projectId, name: projectName })}
    />
  );
}
