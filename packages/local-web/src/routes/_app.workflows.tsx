import { createFileRoute } from '@tanstack/react-router';
import { ModuleLandingPage } from '@/features/app-shell/ui/ModuleLandingPage';

export const Route = createFileRoute('/_app/workflows')({
  component: () => <ModuleLandingPage kind="workflows" />,
});
