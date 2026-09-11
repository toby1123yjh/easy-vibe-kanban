// Test-only data boundary. Real hooks, menus and confirmation dialog run here.
import { useSyncExternalStore } from "react";
import type { Project } from "shared/remote-types";

let projects: Project[] = Array.from({ length: 8 }, (_, index) => ({
  id: `project-${index + 1}`,
  name: `Project ${index + 1}`,
  organization_id: "org-1",
  color: "211 90% 50%",
  sort_order: index,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: `2026-08-${String(20 - index).padStart(2, "0")}T00:00:00Z`,
}));
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => projects;
export function useFixtureProjects() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
export const projectSettingsQueryKey = (projectId: string) =>
  ["project-settings", projectId] as const;

export async function fetchProjectSettingsRecord(projectId: string) {
  return projects.find((project) => project.id === projectId) ?? null;
}

export async function deleteProjectById(
  projectId: string,
  canDelete: () => boolean,
): Promise<void> {
  if (!canDelete()) throw new Error("Project scope changed");
  const requests = JSON.parse(
    document.documentElement.dataset.deleteRequests ?? "[]",
  ) as string[];
  document.documentElement.dataset.deleteRequests = JSON.stringify([
    ...requests,
    projectId,
  ]);
  await new Promise<void>((resolve, reject) => {
    window.addEventListener(
      "fixture-delete-result",
      (event) => {
        if ((event as CustomEvent).detail === "success") resolve();
        else reject(new Error("Simulated deletion failure"));
      },
      { once: true },
    );
  });
  projects = projects.filter((project) => project.id !== projectId);
  listeners.forEach((listener) => listener());
}
