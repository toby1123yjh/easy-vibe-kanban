import { describe, expect, it } from 'vitest';
import {
  buildIssueWorkflowDraft,
  buildWorkflowRunInput,
  getWorkflowRunErrorMessage,
} from './issueWorkflow';

describe('issue workflow helpers', () => {
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
      description: 'The workflow should support editing before execution.',
      repos: [
        {
          repo_id: 'repo-1',
          target_branch: 'main',
        },
      ],
    });

    expect(draft.name).toBe('Workflow attempt for Fix workflow drag handles');
    expect(draft.repos).toEqual([
      {
        repo_id: 'repo-1',
        target_branch: 'main',
      },
    ]);

    const graph = JSON.parse(draft.graph_json);
    expect(graph.version).toBe(2);
    expect(graph.nodes.map((node: { id: string }) => node.id)).toEqual([
      'start',
      'familiarize',
      'end',
    ]);
    expect(
      graph.nodes.every((node: { position?: { x: number; y: number } }) =>
        Boolean(node.position)
      )
    ).toBe(true);
    expect(graph.edges.map((edge: { id: string }) => edge.id)).toEqual([
      'start-familiarize',
      'familiarize-end',
    ]);
  });

  it('allows callers to provide localized draft names and untitled text', () => {
    const draft = buildIssueWorkflowDraft({
      title: '   ',
      name: 'Localized workflow: Untitled task',
      untitledTitle: 'Untitled task',
    });

    expect(draft.name).toBe('Localized workflow: Untitled task');
  });
});
