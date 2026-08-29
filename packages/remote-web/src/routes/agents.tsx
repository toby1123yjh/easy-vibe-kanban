import { createFileRoute } from "@tanstack/react-router";
import { ModuleLandingPage } from "@/features/app-shell/ui/ModuleLandingPage";
import { requireAuthenticated } from "@remote/shared/lib/route-auth";

export const Route = createFileRoute("/agents")({
  beforeLoad: async ({ location }) => requireAuthenticated(location),
  component: () => <ModuleLandingPage kind="agents" />,
});
