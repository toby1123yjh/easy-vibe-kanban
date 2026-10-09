const session = {
  id: "session-1",
  workspace_id: "workspace-1",
  name: "Task task",
  task_id: null as string | null,
};
export const state = { rows: [] as (typeof session)[], mode: "success" };
export const workspacesApi = {
  createAndStart: async () => {
    if (state.mode === "create-failure") throw new Error("create failed");
    state.rows = [session];
    return { workspace: { id: session.workspace_id } };
  },
  linkToTask: async () => {
    if (state.mode === "link-failure") throw new Error("link failed");
    state.rows = [{ ...session, task_id: "issue-1" }];
  },
};
export const sessionsApi = {
  create: async () => {
    if (state.mode === "create-failure") throw new Error("create failed");
    state.rows = [session];
    return session;
  },
  followUp: async () => {
    if (state.mode === "followup-failure") throw new Error("followup failed");
  },
};
export const useHostId = () => null;
export const refreshShapeFallback = () => {};
