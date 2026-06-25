import { describe, expect, it } from 'vitest';
import type {
  WorkflowNodeExecutionResponse,
  WorkflowRunResponse,
  WorkflowRunRuntimeView,
} from 'shared/types';
import {
  getDefaultWorkflowRuntimeNodeId,
  getWorkflowNodeActionGate,
  getWorkflowNodeRuntimeSummary,
  getWorkflowNodeWork,
  getWorkflowRuntimeView,
  isWorkflowNodeProcessing,
} from './workflowRuntimeView';

function node(
  id: string,
  nodeId: string,
  nodeType: string,
  status: WorkflowNodeExecutionResponse['status'],
  iteration = 0n
): WorkflowNodeExecutionResponse {
  return {
    id,
    run_id: 'run-1',
    node_id: nodeId,
    node_type: nodeType,
    iteration,
    status,
    input_text: null,
    output_text: null,
    session_id: null,
    execution_process_id: null,
    arena_group_id: null,
    tokens_used: null,
    cost_estimate: null,
    started_at: null,
    finished_at: null,
    error_text: null,
    created_at: '2026-06-25T00:00:00Z',
    updated_at: '2026-06-25T00:00:00Z',
  };
}

const baseRun = {
  id: 'run-1',
  workflow_id: 'workflow-1',
  attempt_id: null,
  issue_id: 'issue-1',
  workspace_id: 'workspace-1',
  trigger_source: 'manual',
  input_text: 'Build feature',
  output_text: null,
  status: 'running',
  started_at: '2026-06-25T00:00:00Z',
  finished_at: null,
  error_text: null,
  created_at: '2026-06-25T00:00:00Z',
  updated_at: '2026-06-25T00:00:00Z',
  nodes: [],
} satisfies WorkflowRunResponse;

describe('workflow runtime view', () => {
  it('uses the backend projection when present', () => {
    const runtimeView = {
      run_id: 'run-1',
      status: 'running',
      active_node_count: 1,
      pending_node_count: 0,
      waiting_node_count: 0,
      failed_node_count: 0,
      completed_node_count: 0,
      node_work: [
        {
          node_id: 'agent',
          node_type: 'agent',
          iteration: 0n,
          status: 'running',
          pending_work_count: 0,
          starting_child_count: 0,
          active_execution_id: 'exec-1',
          active_session_id: 'session-1',
          execution_process_id: 'process-1',
          active_started_at: '2026-06-25T00:00:00Z',
          active_elapsed_ms: 1000,
          active_slow: false,
          active_slow_threshold_ms: 300000,
          runtime_health: 'ok',
          can_open_session: true,
          can_retry: false,
          can_approve: false,
          can_reject: false,
          can_select_arena_winner: false,
          can_select_condition_branch: false,
          can_cancel_node: false,
        },
      ],
    } satisfies WorkflowRunRuntimeView;

    expect(
      getWorkflowRuntimeView({ ...baseRun, runtime_view: runtimeView })
    ).toBe(runtimeView);
  });

  it('builds a fallback projection from node executions', () => {
    const running = {
      ...node('exec-1', 'agent', 'agent', 'running'),
      session_id: 'session-1',
      execution_process_id: 'process-1',
      started_at: '2026-06-25T00:00:00Z',
    };
    const waiting = node('exec-2', 'approval', 'human_gate', 'awaiting_human');
    const failed = node('exec-3', 'fix', 'agent', 'failed');

    const view = getWorkflowRuntimeView(
      {
        ...baseRun,
        nodes: [running, waiting, failed],
      },
      { nowMs: Date.parse('2026-06-25T00:04:00Z') }
    );

    expect(view).toMatchObject({
      run_id: 'run-1',
      active_node_count: 1,
      waiting_node_count: 1,
      failed_node_count: 1,
    });
    expect(getDefaultWorkflowRuntimeNodeId(view)).toBe('approval');
    expect(isWorkflowNodeProcessing(getWorkflowNodeWork(view, 'agent'))).toBe(
      true
    );
    expect(
      getWorkflowNodeActionGate(getWorkflowNodeWork(view, 'agent'))
    ).toEqual({
      canOpenSession: true,
      canRetry: false,
      canApprove: false,
      canReject: false,
      canSelectArenaWinner: false,
      canSelectConditionBranch: false,
      canCancelNode: false,
    });
  });

  it('marks running nodes without process ids as starting or missing process', () => {
    const starting = {
      ...node('exec-1', 'starting', 'agent', 'running'),
      started_at: '2026-06-25T00:09:30Z',
    };
    const missing = {
      ...node('exec-2', 'missing', 'agent', 'running'),
      started_at: '2026-06-25T00:00:00Z',
    };

    const view = getWorkflowRuntimeView(
      {
        ...baseRun,
        nodes: [starting, missing],
      },
      {
        nowMs: Date.parse('2026-06-25T00:10:00Z'),
        activeSlowThresholdMs: 300000,
      }
    );

    expect(
      getWorkflowNodeRuntimeSummary(getWorkflowNodeWork(view, 'starting')!)
    ).toMatchObject({
      status: 'starting',
      runtimeHealth: 'starting',
      activeSlow: false,
      startingChildCount: 1,
    });
    expect(
      getWorkflowNodeRuntimeSummary(getWorkflowNodeWork(view, 'missing')!)
    ).toMatchObject({
      status: 'starting',
      runtimeHealth: 'process_missing',
      activeSlow: true,
      startingChildCount: 1,
    });
  });

  it('uses the latest node iteration for slot-level work', () => {
    const view = getWorkflowRuntimeView({
      ...baseRun,
      nodes: [
        {
          ...node('exec-1', 'fan-in', 'agent', 'succeeded', 0n),
          updated_at: '2026-06-25T00:00:01Z',
        },
        {
          ...node('exec-2', 'fan-in', 'agent', 'pending', 1n),
          updated_at: '2026-06-25T00:00:02Z',
        },
      ],
    });

    expect(getWorkflowNodeWork(view, 'fan-in')).toMatchObject({
      iteration: 1n,
      status: 'pending',
      pending_work_count: 1,
    });
  });
});
