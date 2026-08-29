import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireAuthenticated } from "@remote/shared/lib/route-auth";

export const Route = createFileRoute("/projects")({
  beforeLoad: async ({ location }) => requireAuthenticated(location),
  component: Outlet,
});
