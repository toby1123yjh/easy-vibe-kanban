import { describe, expect, it } from 'vitest';
import { buildWorkflowRunInput } from './issueWorkflow';

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
});
