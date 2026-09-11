import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactFlowProvider } from "@xyflow/react";
import { ThemeMode, type WorkflowRunResponse } from "shared/types";
import i18n from "../../../../packages/web-core/src/i18n/config";
import "../../../../packages/web-core/src/app/styles/new/index.css";
import "../../../../packages/ui/src/styles/tokens.css";
import { ThemeProvider } from "@/shared/providers/ThemeProvider";
import { useTheme } from "@/shared/hooks/useTheme";
import { AppNavigationProvider } from "@/shared/hooks/useAppNavigation";
import type { AppNavigation } from "@/shared/lib/routes/appNavigation";
import { workflowTemplateQueryKeys } from "@/shared/hooks/useWorkflowTemplates";
import { WorkflowCanvas } from "@/features/workflow/ui/WorkflowCanvas";
import { WorkflowConfigurationFrame } from "@/features/workflow/ui/WorkflowConfigurationFrame";
import { WorkflowRunCanvasTab } from "@/features/workflow/ui/WorkflowRunCanvasTab";
import {
  migrateWorkflowGraph,
  WORKFLOW_GRAPH_VERSION,
  type WorkflowGraph,
} from "@/features/workflow/model/workflowGraph";

void i18n.changeLanguage("en");

const graph: WorkflowGraph = migrateWorkflowGraph({
  version: WORKFLOW_GRAPH_VERSION,
  nodes: [
    {
      id: "start",
      type: "start",
      data: { display_name: "Start" },
      position: { x: 0, y: 180 },
    },
    {
      id: "plan",
      type: "agent",
      data: {
        display_name: "Plan the change",
        prompt_template: "Create an implementation plan.",
        executor_config: { executor: "CODEX" },
      },
      position: { x: 200, y: 100 },
    },
    {
      id: "build",
      type: "agent",
      data: {
        display_name: "Implement the change",
        prompt_template: "Implement the approved plan.",
        executor_config: { executor: "CLAUDE_CODE" },
      },
      position: { x: 560, y: 100 },
    },
    {
      id: "end",
      type: "end",
      data: { display_name: "End" },
      position: { x: 920, y: 180 },
    },
  ],
  edges: [
    { id: "start-plan", source: "start", target: "plan", type: "default" },
    { id: "plan-build", source: "plan", target: "build", type: "default" },
    { id: "build-end", source: "build", target: "end", type: "default" },
  ],
});

const client = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity } },
});
client.setQueryData(workflowTemplateQueryKeys.detail("visual-template"), {
  id: "visual-template",
  graph_json: JSON.stringify(graph),
});

// Navigation must never accidentally leave the isolated fixture or run an Agent.
function unexpectedNavigation(): never {
  throw new Error("Visual fixture must not navigate to an execution");
}
const navigation: AppNavigation = {
  resolveFromPath: () => null,
  goToRoot: unexpectedNavigation,
  goToOnboarding: unexpectedNavigation,
  goToOnboardingSignIn: unexpectedNavigation,
  goToWorkspaces: unexpectedNavigation,
  goToWorkspacesCreate: unexpectedNavigation,
  goToWorkspace: unexpectedNavigation,
  goToWorkspaceVsCode: unexpectedNavigation,
  goToExport: unexpectedNavigation,
  goToProject: unexpectedNavigation,
  goToProjectWorkflows: unexpectedNavigation,
  goToProjectWorkflowEdit: unexpectedNavigation,
  goToProjectWorkflowRun: unexpectedNavigation,
  goToProjectIssue: unexpectedNavigation,
  goToProjectIssueWorkspace: unexpectedNavigation,
  goToProjectIssueWorkspaceCreate: unexpectedNavigation,
  goToProjectWorkspaceCreate: unexpectedNavigation,
};

function makeRun(status: "running" | "succeeded"): WorkflowRunResponse {
  return {
    id: "visual-run",
    orchestration_run_id: null,
    workflow_id: "visual-template",
    attempt_id: null,
    issue_id: "visual-issue",
    workspace_id: "visual-workspace",
    trigger_source: "manual",
    input_text: "Visual fixture",
    output_text: null,
    status,
    started_at: "2026-09-07T00:00:00Z",
    finished_at: null,
    error_text: null,
    created_at: "2026-09-07T00:00:00Z",
    updated_at: "2026-09-07T00:00:01Z",
    nodes: [],
    runtime_view: {
      run_id: "visual-run",
      status,
      active_node_count: status === "running" ? 1 : 0,
      completed_node_count: status === "running" ? 2 : 4,
      pending_node_count: status === "running" ? 1 : 0,
      waiting_node_count: 0,
      failed_node_count: 0,
      node_work: graph.nodes.map((node) => ({
        node_id: node.id,
        node_type: node.type,
        iteration: 0n,
        status:
          node.id === "build"
            ? status
            : node.id === "end" && status === "running"
              ? "pending"
              : "succeeded",
        pending_work_count: 0,
        starting_child_count: 0,
        active_execution_id:
          node.id === "build" && status === "running"
            ? "visual-execution"
            : null,
        active_session_id: null,
        orchestration_node_execution_id: null,
        active_agent_run_id: null,
        projection_status: "current",
        active_started_at: null,
        active_elapsed_ms: null,
        active_slow: false,
        active_slow_threshold_ms: 300000,
        runtime_health: "ok",
        can_open_session: false,
        can_retry: false,
        can_approve: false,
        can_reject: false,
        can_select_arena_winner: false,
        can_select_condition_branch: false,
        can_cancel_node: false,
      })),
    },
  };
}

const runtime = new URLSearchParams(location.search).get("mode") === "run";

function Fixture() {
  const { setTheme } = useTheme();
  const [currentGraph, setGraph] = useState(graph);
  const [selection, setSelection] = useState<string | null>(null);
  const [run, setRun] = useState(() => makeRun("running"));
  const selected = currentGraph.nodes.find((node) => node.id === selection);

  return (
    <div
      className="new-design"
      style={{ height: "100dvh", display: "flex", flexDirection: "column" }}
    >
      <header style={{ display: "flex", gap: 16, padding: 12 }}>
        <button onClick={() => setTheme(ThemeMode.LIGHT)}>Light</button>
        <button onClick={() => setTheme(ThemeMode.DARK)}>Dark</button>
        <button onClick={() => setTheme(ThemeMode.SYSTEM)}>System</button>
        {runtime ? (
          <button onClick={() => setRun(makeRun("succeeded"))}>
            Complete run
          </button>
        ) : null}
      </header>
      <div
        data-testid="visual-canvas"
        style={{ flex: 1, minHeight: 0, position: "relative" }}
      >
        {runtime ? (
          <WorkflowRunCanvasTab projectId="visual-project" run={run} />
        ) : (
          <WorkflowCanvas
            graph={currentGraph}
            onChange={setGraph}
            selectedNodeId={selection}
            onSelectionChange={(next) => setSelection(next.nodeId)}
            onNodeEdit={setSelection}
          />
        )}
        {!runtime ? (
          <WorkflowConfigurationFrame
            open={!!selected}
            title={selected?.data.display_name ?? "Node"}
            description="Configure this Node"
            objectKey={selection ?? ""}
            onClose={() => setSelection(null)}
          >
            <label style={{ display: "block", padding: 16 }}>
              Task name
              <input
                aria-label="Task name"
                value={selected?.data.display_name ?? ""}
                onChange={(event) =>
                  setGraph((current) => ({
                    ...current,
                    nodes: current.nodes.map((node) =>
                      node.id === selection
                        ? {
                            ...node,
                            data: {
                              ...node.data,
                              display_name: event.target.value,
                            },
                          }
                        : node,
                    ),
                  }))
                }
              />
            </label>
            <div style={{ height: 1200, padding: 16 }}>
              Scrollable Node configuration
            </div>
          </WorkflowConfigurationFrame>
        ) : null}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <AppNavigationProvider value={navigation}>
      <ThemeProvider initialTheme={ThemeMode.LIGHT}>
        <ReactFlowProvider>
          <Fixture />
        </ReactFlowProvider>
      </ThemeProvider>
    </AppNavigationProvider>
  </QueryClientProvider>,
);
