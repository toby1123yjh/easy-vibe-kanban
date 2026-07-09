import { describe, expect, it } from 'vitest';
import type { ModelInfo } from 'shared/types';
import {
  buildModelSelectionOverride,
  resolveDefaultReasoningId,
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
  it('does not write discovery default reasoning when selecting a model', () => {
    expect(buildModelSelectionOverride(models, 'gpt-5.5')).toEqual({
      model_id: 'gpt-5.5',
    });
  });

  it('includes provider-scoped model ids without reasoning overrides', () => {
    expect(buildModelSelectionOverride(models, 'sonnet', 'anthropic')).toEqual({
      model_id: 'anthropic/sonnet',
    });
  });

  it('returns only the model override when the model has no reasoning options', () => {
    expect(buildModelSelectionOverride(models, 'haiku', 'anthropic')).toEqual({
      model_id: 'anthropic/haiku',
    });
  });

  it('keeps the discovery default available only as metadata', () => {
    expect(resolveDefaultReasoningId(models[0].reasoning_options)).toBe(
      'xhigh'
    );
  });

  it('validates preferred reasoning without falling back to the model default', () => {
    expect(
      resolveReasoningIdForOptions(models[0].reasoning_options, 'medium')
    ).toBe('medium');
    expect(
      resolveReasoningIdForOptions(models[0].reasoning_options, 'low')
    ).toBeNull();
    expect(
      resolveReasoningIdForOptions(models[0].reasoning_options, null)
    ).toBeNull();
  });
});
