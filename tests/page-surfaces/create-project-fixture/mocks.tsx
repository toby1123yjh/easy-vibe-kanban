import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
export * from '../../../packages/web-core/src/shared/lib/remoteApi';
export * from '../../../packages/web-core/src/shared/lib/electric/collections';

export const isLocalRemoteApiEnabled = () => new URLSearchParams(location.search).has('local');
export async function openLocalProjectDirectory(input: { name: string; color: string }, hostId: string | null) {
  record('opens', { input, hostId });
  return {
    id: 'restored-project', organization_id: 'org-1', name: 'Portable project', color: input.color,
  };
}
export function refreshShapeFallback(_shape: unknown, params: unknown, hostId: string | null) {
  record('refreshes', { params, hostId });
}
export async function makeLocalApiRequest(path: string, options: object) {
  record('requests', { path, ...options });
  return new Response(JSON.stringify({ tasks: [], data: {}, templates: [] }), { status: 200 });
}

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
    remove: (id: string) => {
      record("removes", id);
      const fails =
        new URLSearchParams(location.search).has("cancel-fail") &&
        JSON.parse(document.documentElement.dataset.removes!).length === 1;
      return {
        persisted: fails
          ? Promise.reject(new Error("Simulated delete failure"))
          : Promise.resolve(),
      };
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
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const onOffline = () => setOffline(true);
    window.addEventListener("fixture-host-offline", onOffline);
    return () => window.removeEventListener("fixture-host-offline", onOffline);
  }, []);
  const selectedHost = hosts.find((h) => h.id === context.selectedHostId);
  return {
    ...context,
    selectedHost:
      offline && selectedHost?.kind === "remote"
        ? { ...selectedHost, status: "offline" }
        : selectedHost,
    availableHosts: hosts,
  };
}

export const WorkspaceTargetDialog = {
  async show(options: unknown) {
    record("picker", options);
    if (new URLSearchParams(location.search).has("picker-cancel"))
      return { kind: "canceled" };
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
