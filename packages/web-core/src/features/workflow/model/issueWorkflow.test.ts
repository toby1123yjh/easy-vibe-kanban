import { describe, expect, it } from 'vitest';
import {
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
});
