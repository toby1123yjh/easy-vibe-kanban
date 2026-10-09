import { createFileRoute, Outlet } from '@tanstack/react-router';
import { projectSearchValidator } from '@vibe/web-core/project-search';

export const Route = createFileRoute('/_app/projects')({
  validateSearch: projectSearchValidator,
  component: Outlet,
});
