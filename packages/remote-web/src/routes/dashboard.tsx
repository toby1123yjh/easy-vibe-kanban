import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "@/features/app-shell/ui/DashboardPage";
import { requireAuthenticated } from "@remote/shared/lib/route-auth";

export const Route = createFileRoute("/dashboard")({
  beforeLoad: async ({ location }) => requireAuthenticated(location),
  component: DashboardPage,
});
