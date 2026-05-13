import { describe, expect, it } from 'vitest';
import {
  getWorkflowNodeSchema,
  getWorkflowNodeSchemaFields,
} from './workflowNodeSchemas';

describe('workflow node schemas', () => {
  it('defines editable fields for Agent Step', () => {
    expect(
      getWorkflowNodeSchemaFields('agent').map((field) => field.key)
    ).toEqual(['display_name', 'role_template_id', 'prompt_template']);
  });

  it('marks prompt template as a multiline field', () => {
    expect(getWorkflowNodeSchema('agent').fields).toContainEqual(
      expect.objectContaining({
        key: 'prompt_template',
        type: 'textarea',
        label: 'Prompt Template',
      })
    );
  });
});
