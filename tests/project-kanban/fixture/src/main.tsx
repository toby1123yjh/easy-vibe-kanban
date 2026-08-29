import * as React from "react";
import { createRoot } from "react-dom/client";
import type { TaskSummary } from "shared/types";
import type {
  KanbanColumnProjection,
  KanbanMoveUpdate,
} from "../../../../packages/web-core/src/features/projects/model/project-kanban";
import { ProjectKanbanView } from "../../../../packages/web-core/src/features/projects/ui/ProjectKanbanView";
import "../../../../packages/ui/src/styles/tokens.css";
import "./style.css";

const task: TaskSummary = {
  id: "task-1",
  project_id: "project-1",
  issue_id: "issue-1",
  parent_task_id: null,
  title: "Run the canonical agent task",
  execution_kind: "agent",
  status: "running",
  open_target: {
    kind: "agent",
    session_id: "session-1",
    workspace_id: "workspace-1",
  },
  created_at: "2026-08-29T00:00:00Z",
  updated_at: "2026-08-29T00:00:00Z",
};

const columns: KanbanColumnProjection[] = [
  {
    id: "todo",
    name: "Todo",
    color: "220 16% 56%",
    sortOrder: 1,
    issues: [
      {
        id: "issue-1",
        simpleId: "VK-1",
        title: "Keyboard and pointer interaction",
        statusId: "todo",
        priority: "high",
        sortOrder: 1,
        tags: [],
        tasks: [task],
      },
      {
        id: "issue-2",
        simpleId: "VK-2",
        title: "Second sortable issue",
        statusId: "todo",
        priority: null,
        sortOrder: 2,
        tags: [],
        tasks: [],
      },
      ...Array.from({ length: 10 }, (_, index) => ({
        id: `issue-long-${index}`,
        simpleId: `VK-${index + 3}`,
        title: `Long column issue ${index + 1}`,
        statusId: "todo",
        priority: null,
        sortOrder: index + 3,
        tags: [],
        tasks: [],
      })),
    ],
  },
  {
    id: "doing",
    name: "Doing",
    color: "211 90% 50%",
    sortOrder: 2,
    issues: [
      {
        id: "issue-doing",
        simpleId: "VK-20",
        title: "Cross-column destination",
        statusId: "doing",
        priority: null,
        sortOrder: 1,
        tags: [],
        tasks: [],
      },
    ],
  },
  {
    id: "done",
    name: "Done",
    color: "142 71% 45%",
    sortOrder: 3,
    issues: [],
  },
];

function Harness() {
  const [selectedIssueId, setSelectedIssueId] = React.useState<string | null>(
    null,
  );
  const [moveCount, setMoveCount] = React.useState(0);
  const [taskOpenCount, setTaskOpenCount] = React.useState(0);
  const [rejectMove, setRejectMove] = React.useState(false);
  const moveCountRef = React.useRef(0);

  const move = async (_updates: KanbanMoveUpdate[]) => {
    moveCountRef.current += 1;
    setMoveCount(moveCountRef.current);
    if (rejectMove) throw new Error("Fixture mutation failure");
  };

  return (
    <>
      <ProjectKanbanView
        projectName="Fixture project"
        columns={columns}
        issueCount={columns.reduce(
          (count, column) => count + column.issues.length,
          0,
        )}
        query=""
        selectedIssueId={selectedIssueId}
        dragDisabled={false}
        taskSource={{ state: "ready" }}
        panel={
          selectedIssueId ? (
            <aside
              className="vk-issue-floating-panel"
              aria-label="Issue details"
            >
              <div className="fixture-panel">
                <h2>{selectedIssueId}</h2>
                <button type="button" onClick={() => setSelectedIssueId(null)}>
                  Close panel
                </button>
              </div>
            </aside>
          ) : null
        }
        onQueryChange={() => undefined}
        onCreateIssue={() => undefined}
        onOpenIssue={(issueId) => setSelectedIssueId(issueId)}
        onOpenTask={() => setTaskOpenCount((count) => count + 1)}
        onDeleteIssue={async () => undefined}
        getTaskUnavailableReason={() => null}
        onMove={move}
      />
      <div className="fixture-controls">
        <output data-testid="move-count">{moveCount}</output>
        <output data-testid="task-open-count">{taskOpenCount}</output>
        <button type="button" onClick={() => setRejectMove((value) => !value)}>
          Toggle mutation failure
        </button>
      </div>
    </>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Project Kanban fixture root is missing");
createRoot(root).render(<Harness />);
