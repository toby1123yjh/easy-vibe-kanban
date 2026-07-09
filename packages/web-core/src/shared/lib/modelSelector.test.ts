import { describe, expect, it } from 'vitest';
import type { ModelInfo } from 'shared/types';
import {
  buildModelSelectionOverride,
  resolveReasoningIdForOptions,
} from './modelSelector';

const models: ModelInfo[] = [
  {
    id: 'gpt-5.5',
    name: 'GPT-5.5',
    provider_id: null,
    reasoning_options: [
      { id: 'medium', label: 'Medium', is_default: false },
      { id: 'xhigh', label: 'Extra High', is_default: true },
    ],
  },
  {
    id: 'sonnet',
    name: 'Sonnet',
    provider_id: 'anthropic',
    reasoning_options: [
      { id: 'medium', label: 'Medium', is_default: false },
      { id: 'high', label: 'High', is_default: true },
    ],
  },
  {
    id: 'haiku',
    name: 'Haiku',
    provider_id: 'anthropic',
    reasoning_options: [],
  },
];

describe('model selector reasoning overrides', () => {
  it('uses the selected model default reasoning when selecting a model', () => {
    expect(buildModelSelectionOverride(models, 'gpt-5.5')).toEqual({
      model_id: 'gpt-5.5',
      reasoning_id: 'xhigh',
    });
  });

  it('includes provider-scoped model ids and reasoning defaults', () => {
    expect(buildModelSelectionOverride(models, 'sonnet', 'anthropic')).toEqual({
      model_id: 'anthropic/sonnet',
      reasoning_id: 'high',
    });
  });

  it('clears reasoning when the selected model has no reasoning options', () => {
    expect(buildModelSelectionOverride(models, 'haiku', 'anthropic')).toEqual({
      model_id: 'anthropic/haiku',
      reasoning_id: null,
    });
  });

  it('replaces invalid reasoning with the model default', () => {
    expect(
      resolveReasoningIdForOptions(models[0].reasoning_options, 'medium')
    ).toBe('medium');
    expect(
      resolveReasoningIdForOptions(models[0].reasoning_options, 'low')
    ).toBe('xhigh');
  });
});
