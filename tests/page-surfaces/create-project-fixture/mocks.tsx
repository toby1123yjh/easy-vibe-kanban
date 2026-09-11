import { createContext, useContext, useState, type ReactNode } from "react";

function record(key: string, value: unknown) {
  const data = document.documentElement.dataset;
  data[key] = JSON.stringify([...JSON.parse(data[key] ?? "[]"), value]);
}

export function useShape() {
  return {
    insert: (input: unknown) => {
      record("inserts", input);
      const project = { id: "created-project", ...(input as object) };
      return { data: project, persisted: Promise.resolve(project) };
    },
    error: null,
  };
}

const hosts = [
  { id: "local", apiHostId: null, label: "This machine", kind: "local" },
  {
    id: "remote-1",
    apiHostId: "remote-1",
    label: "Remote machine",
    kind: "remote",
    status: "online",
  },
];
const HostContext = createContext({
  selectedHostId: "local",
  setSelectedHostId: (_: string) => {},
});
export function SettingsHostProvider({ children }: { children: ReactNode }) {
  const [selectedHostId, setSelectedHostId] = useState("local");
  return (
    <HostContext.Provider value={{ selectedHostId, setSelectedHostId }}>
      {children}
    </HostContext.Provider>
  );
}
export function useSettingsHost() {
  const context = useContext(HostContext);
  return {
    ...context,
    selectedHost: hosts.find((h) => h.id === context.selectedHostId),
    availableHosts: hosts,
  };
}

export const WorkspaceTargetDialog = {
  async show(options: unknown) {
    record("picker", options);
    const git = new URLSearchParams(location.search).get("mode") === "git";
    return {
      kind: "confirmed",
      selection: git
        ? {
            mode: "worktree",
            path: "/fixture/repo",
            repo: { id: "repo-2" },
            targetBranch: "feature/test",
          }
        : { mode: "direct_folder", path: "/fixture/folder" },
    };
  },
};

export const projectWorkspaceDefaultQueryKey = (
  id: string,
  hostId: string | null,
) => ["project-default", id, hostId];
export async function saveProjectWorkspaceDefault(
  projectId: string,
  value: unknown,
  hostId: string | null,
) {
  record("saves", { projectId, value, hostId });
  if (new URLSearchParams(location.search).has("hold")) {
    await new Promise<void>((resolve) =>
      window.addEventListener("fixture-save-release", () => resolve(), {
        once: true,
      }),
    );
  }
  if (
    new URLSearchParams(location.search).has("fail") &&
    JSON.parse(document.documentElement.dataset.saves!).length === 1
  ) {
    throw new Error("Simulated save failure");
  }
}
