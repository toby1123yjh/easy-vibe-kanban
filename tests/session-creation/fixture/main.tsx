import React from "react";
import { createRoot } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { useCreateWorkspace } from "@/shared/hooks/useCreateWorkspace";
import { useCreateSession } from "@/features/workspace-chat/model/hooks/useCreateSession";
import { appShellDiscoveryQueryKey } from "@/features/app-shell/model/appShell";
import { state } from "./mocks";

const client = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, retry: false } },
});
const calls = { sessions: 0, projects: 0 };
const params = new URLSearchParams(location.search);
state.mode = params.get("mode") ?? "success";

function Fixture() {
  const { createWorkspace } = useCreateWorkspace();
  const createSession = useCreateSession();
  const sessions = useQuery({
    queryKey: appShellDiscoveryQueryKey("local-host-user", "sessions"),
    queryFn: async () => {
      calls.sessions++;
      return [...state.rows];
    },
  });
  useQuery({
    queryKey: appShellDiscoveryQueryKey("local-host-user", "projects"),
    queryFn: async () => {
      calls.projects++;
      return [];
    },
  });
  const direct = params.get("direct") === "1";
  return (
    <>
      <button
        onClick={() =>
          direct
            ? createSession.mutate({
                workspaceId: "workspace-1",
                prompt: "hello",
                executorConfig: { executor: "CODEX" },
              })
            : createWorkspace.mutate({
                data: {} as never,
                linkToIssue: {
                  remoteProjectId: "project-1",
                  issueId: "issue-1",
                },
              })
        }
      >
        Create
      </button>
      <output data-testid="status">
        {direct ? createSession.status : createWorkspace.status}
      </output>
      <output data-testid="calls">
        {calls.sessions}/{calls.projects}
      </output>
      <nav>
        {sessions.data?.map((row) => (
          <span key={row.id}>{row.name}</span>
        ))}
      </nav>
      <output data-testid="rows">{JSON.stringify(sessions.data)}</output>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <Fixture />
  </QueryClientProvider>,
);
