import { useCallback } from 'react';
import { ArrowSquareOutIcon, DownloadSimpleIcon } from '@phosphor-icons/react';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { usePageTitle } from '@/shared/hooks/usePageTitle';
import { Button } from '@vibe/ui/components/Button';
import { StateSurface } from '@vibe/ui/components/StateSurface';

interface ProjectSunsetPageProps {
  projectName?: string;
}

export function ProjectSunsetPage({ projectName }: ProjectSunsetPageProps) {
  const appNavigation = useAppNavigation();

  usePageTitle(projectName, 'Project retired');

  const handleExportClick = useCallback(() => {
    appNavigation.goToExport();
  }, [appNavigation]);

  return (
    <div className="h-full w-full overflow-auto bg-primary">
      <div className="mx-auto flex min-h-full w-full max-w-3xl items-center px-base py-double">
        <StateSurface
          state="degraded"
          className="w-full rounded-[var(--vk-radius-md)] border border-[var(--vk-border-subtle)] bg-[var(--vk-surface-secondary)]"
          title={<h1>Project functionality has been retired</h1>}
          description={
            <>
              {projectName
                ? `"${projectName}" is now export-only.`
                : 'This project is now export-only.'}{' '}
              You can still download your project and issue data, but kanban,
              issue, and workspace flows are no longer available here.
            </>
          }
          action={
            <div className="flex flex-col gap-[var(--vk-space-2)] sm:flex-row">
              <Button
                className="min-h-11"
                size="lg"
                onClick={handleExportClick}
              >
                <DownloadSimpleIcon className="size-icon-base" weight="bold" />
                Export data
              </Button>
              <Button
                asChild
                className="min-h-11"
                size="lg"
                variant="secondary"
              >
                <a
                  href="https://vibekanban.com/shutdown"
                  target="_blank"
                  rel="noreferrer"
                >
                  <ArrowSquareOutIcon
                    className="size-icon-base"
                    weight="bold"
                  />
                  Read about the shutdown
                </a>
              </Button>
            </div>
          }
        />
      </div>
    </div>
  );
}
