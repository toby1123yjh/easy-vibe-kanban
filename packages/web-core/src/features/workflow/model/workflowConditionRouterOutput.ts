export interface WorkflowConditionRouterDecision {
  schema_version?: number;
  status?: string;
  selected_target_node_ids: string[];
  skipped_target_node_ids: string[];
  confidence?: string;
  reason?: string;
  question?: string;
}

export interface WorkflowConditionRouterValidation {
  result?: string;
  reason?: string | null;
  mutation_warning?: string | null;
  overrode_router_mutation_warning?: boolean;
}

export interface WorkflowConditionRouterOutput {
  type: 'condition_router_decision';
  source?: string;
  status?: string;
  schema_version?: number;
  decision: WorkflowConditionRouterDecision | null;
  raw_output?: string;
  selected_target_node_ids: string[];
  skipped_target_node_ids: string[];
  validation?: WorkflowConditionRouterValidation;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function readVersion(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function parseRouterDecision(
  value: unknown
): WorkflowConditionRouterDecision | null {
  if (!isRecord(value)) return null;

  return {
    schema_version: readVersion(value.schema_version),
    status: readString(value.status),
    selected_target_node_ids: readStringArray(value.selected_target_node_ids),
    skipped_target_node_ids: readStringArray(value.skipped_target_node_ids),
    confidence: readString(value.confidence),
    reason: readString(value.reason),
    question: readString(value.question),
  };
}

function parseRouterValidation(
  value: unknown
): WorkflowConditionRouterValidation | undefined {
  if (!isRecord(value)) return undefined;

  return {
    result: readString(value.result),
    reason:
      typeof value.reason === 'string' || value.reason === null
        ? value.reason
        : undefined,
    mutation_warning:
      typeof value.mutation_warning === 'string' ||
      value.mutation_warning === null
        ? value.mutation_warning
        : undefined,
    overrode_router_mutation_warning: readOptionalBoolean(
      value.overrode_router_mutation_warning
    ),
  };
}

export function parseConditionRouterOutput(
  outputText: string | null | undefined
): WorkflowConditionRouterOutput | null {
  if (!outputText) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || parsed.type !== 'condition_router_decision') {
    return null;
  }

  return {
    type: 'condition_router_decision',
    source: readString(parsed.source),
    status: readString(parsed.status),
    schema_version: readVersion(parsed.schema_version),
    decision: parseRouterDecision(parsed.decision),
    raw_output: readString(parsed.raw_output),
    selected_target_node_ids: readStringArray(parsed.selected_target_node_ids),
    skipped_target_node_ids: readStringArray(parsed.skipped_target_node_ids),
    validation: parseRouterValidation(parsed.validation),
  };
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function getConditionRouterHumanPrompt(
  output: WorkflowConditionRouterOutput | null
): string | null {
  if (!output) return null;

  return (
    nonEmpty(output.decision?.question) ??
    nonEmpty(output.validation?.reason) ??
    nonEmpty(output.decision?.reason)
  );
}

export function getConditionRouterReason(
  output: WorkflowConditionRouterOutput | null
): string | null {
  if (!output) return null;

  const question = nonEmpty(output.decision?.question);
  const reason =
    nonEmpty(output.decision?.reason) ?? nonEmpty(output.validation?.reason);

  return reason && reason !== question ? reason : null;
}

export function getConditionRouterSelectedTargetIds(
  output: WorkflowConditionRouterOutput | null
): string[] {
  if (!output) return [];
  return output.selected_target_node_ids.length > 0
    ? output.selected_target_node_ids
    : (output.decision?.selected_target_node_ids ?? []);
}

export function getConditionRouterSkippedTargetIds(
  output: WorkflowConditionRouterOutput | null
): string[] {
  if (!output) return [];
  return output.skipped_target_node_ids.length > 0
    ? output.skipped_target_node_ids
    : (output.decision?.skipped_target_node_ids ?? []);
}
