import { describe, expect, it } from 'vitest';
import type { ModelInfo } from 'shared/types';
import {
  buildModelSelectionOverride,
  getReasoningOverrideRepair,
  resolveConfiguredReasoningIdForOptions,
  resolveDefaultReasoningId,
  resolveReasoningOverrideState,
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

  it('does not invent a default reasoning option from list order', () => {
    expect(
      resolveDefaultReasoningId([
        { id: 'medium', label: 'Medium', is_default: false },
        { id: 'high', label: 'High', is_default: false },
      ])
    ).toBeNull();
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

  it('resolves only configured reasoning for display and send semantics', () => {
    expect(
      resolveConfiguredReasoningIdForOptions(
        models[0].reasoning_options,
        'xhigh',
        true
      )
    ).toBe('xhigh');
    expect(
      resolveConfiguredReasoningIdForOptions(
        models[0].reasoning_options,
        'xhigh',
        false
      )
    ).toBeNull();
    expect(
      resolveConfiguredReasoningIdForOptions(
        models[0].reasoning_options,
        'low',
        true
      )
    ).toBeNull();
    expect(
      resolveConfiguredReasoningIdForOptions(
        models[0].reasoning_options,
        null,
        true
      )
    ).toBeNull();
  });

  it('repairs invalid or stale configured reasoning without auto-applying defaults', () => {
    expect(
      getReasoningOverrideRepair(models[0].reasoning_options, 'xhigh', true)
    ).toBeNull();
    expect(
      getReasoningOverrideRepair(models[0].reasoning_options, 'low', true)
    ).toEqual({ reasoning_id: null });
    expect(
      getReasoningOverrideRepair(models[0].reasoning_options, '', true)
    ).toEqual({ reasoning_id: null });
    expect(
      getReasoningOverrideRepair(models[2].reasoning_options, 'high', true)
    ).toEqual({ reasoning_id: null });
    expect(
      getReasoningOverrideRepair(models[0].reasoning_options, undefined, false)
    ).toBeNull();
    expect(
      getReasoningOverrideRepair(models[0].reasoning_options, null, true)
    ).toBeNull();
  });

  it('keeps the container state on CLI config when no override exists', () => {
    expect(
      resolveReasoningOverrideState(
        models[0].reasoning_options,
        undefined,
        false
      )
    ).toEqual({
      selectedReasoningId: null,
      repair: null,
    });
  });

  it('clears stale container state instead of applying discovery defaults', () => {
    expect(
      resolveReasoningOverrideState(
        models[0].reasoning_options,
        'unsupported',
        true
      )
    ).toEqual({
      selectedReasoningId: null,
      repair: { reasoning_id: null },
    });
  });
});
