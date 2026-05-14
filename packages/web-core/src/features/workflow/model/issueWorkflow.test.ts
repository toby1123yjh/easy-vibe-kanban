import { describe, expect, it } from 'vitest';
import {
  ISSUE_WORKFLOW_ENTRY_COPY,
  buildIssueWorkflowDraft,
  buildWorkflowRunInput,
  getWorkflowRunErrorMessage,
} from './issueWorkflow';

describe('issue workflow helpers', () => {
  it('presents workflow as an issue task attempt', () => {
    expect(ISSUE_WORKFLOW_ENTRY_COPY.title).toBe('Workflow attempt');
    expect(ISSUE_WORKFLOW_ENTRY_COPY.primaryActionLabel).toBe('Open canvas');
    expect(ISSUE_WORKFLOW_ENTRY_COPY.primaryActionAriaLabel).toBe(
      'Open workflow attempt canvas'
    );
    expect(ISSUE_WORKFLOW_ENTRY_COPY.secondaryActionLabel).toBe('Run attempt');
    expect(ISSUE_WORKFLOW_ENTRY_COPY.secondaryActionAriaLabel).toBe(
      'Run workflow attempt'
    );
  });

  it('builds default run input from issue title and description', () => {
    expect(
      buildWorkflowRunInput({
        title: 'Fix flaky CI',
        description: 'The Windows job fails during linking.',
      })
    ).toBe('Fix flaky CI\n\nThe Windows job fails during linking.');
  });

  it('omits blank descriptions from default run input', () => {
    expect(
      buildWorkflowRunInput({
        title: 'Fix flaky CI',
        description: '   ',
      })
    ).toBe('Fix flaky CI');
  });

  it('turns missing repository failures into actionable workflow copy', () => {
    expect(
      getWorkflowRunErrorMessage(
        new Error('Workspace has no repositories configured (400 Bad Request)')
      )
    ).toBe(
      'This workflow needs a workspace with at least one repository. Choose an existing workspace with repositories, or add a repository to the project before starting the run.'
    );
  });

  it('builds an editable workflow draft from issue context', () => {
    const draft = buildIssueWorkflowDraft({
      title: 'Fix workflow drag handles',
      description: 'The canvas should support editing before execution.',
    });

    expect(draft.name).toBe('Workflow attempt for Fix workflow drag handles');
    expect(draft.description).toBe(
      'Issue-bound workflow task attempt. Design the canvas before starting the run.'
    );

    const graph = JSON.parse(draft.graph_json);
    expect(graph.version).toBe(1);
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.edges.length).toBeGreaterThan(0);
  });
});
