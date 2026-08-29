import { createFileRoute } from "@tanstack/react-router";
import { ProjectDirectoryPage } from "@/features/projects/ui/ProjectDirectoryPage";

export const Route = createFileRoute("/projects/")({
  component: ProjectDirectoryPage,
});
