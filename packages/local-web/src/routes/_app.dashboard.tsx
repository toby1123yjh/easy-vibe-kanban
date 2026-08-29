import { createFileRoute } from '@tanstack/react-router';
import { DashboardPage } from '@/features/app-shell/ui/DashboardPage';

export const Route = createFileRoute('/_app/dashboard')({
  component: DashboardPage,
});
