import type {
  WorkflowConditionBranch,
  WorkflowGraph,
  WorkflowNode,
  WorkflowNodeData,
  WorkflowNodeKind,
} from '../model/workflowGraph';
import { getConditionBranchTargets } from '../model/workflowGraph';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import {
  getWorkflowNodeSchema,
  type WorkflowNodeFieldSchema,
} from '../model/workflowNodeSchemas';
import { getWorkflowAgentDisplay } from '../model/workflowAgentDisplay';
import { getWorkflowNodeKindLabel } from '../model/workflowPresentation';
import { AgentIcon } from '@/shared/components/AgentIcon';
import { WorkflowNodeFieldRenderer } from './WorkflowNodeFieldRenderer';
import { getWorkflowNodeIcon } from './workflowNodeIcons';
import { Plus, Settings2, Trash2 } from 'lucide-react';

export interface WorkflowNodeInspectorProps {
  node: WorkflowNode | null;
  graph?: WorkflowGraph | null;
  routerExecutorConfig?: unknown;
  readOnly?: boolean;
  onChange?: (nodeId: string, data: Partial<WorkflowNodeData>) => void;
  onConfigureRouter?: () => void;
}

const simpleFieldTypes = new Set(['text', 'textarea', 'select', 'number']);

function isSimpleField(field: WorkflowNodeFieldSchema) {
  return simpleFieldTypes.has(field.type);
}

function shouldRenderSimpleField(
  type: WorkflowNodeKind,
  data: WorkflowNodeData,
  field: WorkflowNodeFieldSchema
) {
  if (type !== 'transform') {
    return true;
  }

  if (field.key === 'template') {
    return (data.mode ?? 'template') === 'template';
  }
  if (field.key === 'regex') {
    return data.mode === 'regex_extract';
  }
  if (field.key === 'max_chars') {
    return data.mode === 'truncate';
  }
  return true;
}

function getLocalizedField(
  field: WorkflowNodeFieldSchema,
  t: TFunction<'common'>
): WorkflowNodeFieldSchema {
  const label = t(`workflow.fields.${String(field.key)}`, {
    defaultValue: field.label,
  });
  const options = field.options?.map((option) => ({
    ...option,
    label: t(`workflow.fieldOptions.${String(field.key)}.${option.value}`, {
      defaultValue: option.label,
    }),
  }));
  return { ...field, label, ...(options ? { options } : {}) };
}

export function WorkflowNodeInspector({
  node,
  graph,
  routerExecutorConfig,
  readOnly,
  onChange,
  onConfigureRouter,
}: WorkflowNodeInspectorProps) {
  const { t } = useTranslation('common');
  if (!node) {
    return (
      <div className="flex h-full items-center justify-center p-base text-center text-low text-sm">
        {t('workflow.inspector.selectNode')}
      </div>
    );
  }

  const handleChange = (key: keyof WorkflowNodeData, value: unknown) => {
    if (readOnly || !onChange) return;
    onChange(node.id, { [key]: value });
  };

  const { data, type } = node;
  const Icon = getWorkflowNodeIcon(type);
  const schema = getWorkflowNodeSchema(type);
  const schemaFields = schema.fields;
  const simpleFields = schemaFields
    .filter(isSimpleField)
    .filter((field) => shouldRenderSimpleField(type, data, field))
    .map((field) => getLocalizedField(field, t));
  const hasConditionBranches = schemaFields.some(
    (field) => field.type === 'condition_branches'
  );
  const hasArenaAttempts = schemaFields.some(
    (field) => field.type === 'arena_attempts'
  );
  const branches = data.branches ?? [];
  const conditionBranchTargets =
    type === 'condition' && graph
      ? getConditionBranchTargets(graph, node.id)
      : [];
  const attempts = data.attempts ?? [];
  const routerDisplay = getWorkflowAgentDisplay({
    executor_config: routerExecutorConfig,
  });
  const hasRouterExecutorConfig = routerDisplay.executorConfig !== null;

  const inputClass =
    'w-full rounded-md border border-secondary bg-primary px-3 py-1.5 text-sm shadow-sm transition-colors focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand disabled:opacity-50';
  const secondaryButtonClass =
    'inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-secondary bg-primary px-2.5 text-xs font-medium text-high shadow-sm transition-colors hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-50';
  const iconButtonClass =
    'inline-flex h-8 w-8 items-center justify-center rounded-md border border-secondary bg-primary text-low shadow-sm transition-colors hover:border-error/70 hover:text-error disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto bg-panel/50 p-5 text-sm">
      <div className="mb-2 flex items-center gap-3 border-b border-secondary pb-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-secondary/40 bg-secondary/20 shadow-sm">
          <Icon className="h-4 w-4 text-high" />
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-low">
            {t('workflow.inspector.step')}
          </span>
          <span className="text-sm font-semibold text-high">
            {getWorkflowNodeKindLabel(type, t)}
          </span>
        </div>
      </div>

      {simpleFields.map((field) => (
        <WorkflowNodeFieldRenderer
          key={String(field.key)}
          data={data}
          field={field}
          inputClassName={inputClass}
          readOnly={readOnly}
          onChange={handleChange}
        />
      ))}

      {type === 'condition' ? (
        <div className="flex flex-col gap-2 rounded-md border border-secondary/60 bg-primary/50 p-3 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <label className="text-xs font-semibold text-high">
                {t('workflow.inspector.routerAgent', {
                  defaultValue: 'Router agent',
                })}
              </label>
              <p className="mt-1 text-xs text-low">
                {t('workflow.inspector.routerSharedNote', {
                  defaultValue: 'Used by all Condition nodes in this workflow.',
                })}
              </p>
            </div>
            <button
              type="button"
              className={secondaryButtonClass}
              disabled={readOnly || !onConfigureRouter}
              onClick={onConfigureRouter}
            >
              <Settings2 className="h-3.5 w-3.5" />
              {t('workflow.inspector.configureRouter', {
                defaultValue: 'Configure',
              })}
            </button>
          </div>

          {hasRouterExecutorConfig ? (
            <div className="flex items-center gap-2 rounded-md border border-brand/20 bg-brand/10 px-2.5 py-2">
              <AgentIcon
                agent={routerDisplay.executor}
                className="size-5 shrink-0"
              />
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-high">
                  {routerDisplay.agentLabel}
                </div>
                <div className="truncate text-xs text-low">
                  {routerDisplay.modelLabel}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-xs text-warning">
              {t('workflow.inspector.routerMissing', {
                defaultValue: 'Router agent is not configured.',
              })}
            </div>
          )}
        </div>
      ) : null}

      {type === 'condition' && hasConditionBranches ? (
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-high">
            {t('workflow.inspector.branches')}
          </label>
          <p className="text-xs leading-relaxed text-low">
            {t('workflow.inspector.conditionBranchHelp', {
              defaultValue:
                'Each outgoing line becomes a branch. Describe when the router should choose each target.',
            })}
          </p>
          {branches.length === 0 ? (
            <div className="rounded-md border border-secondary/60 bg-primary/50 p-3 text-xs text-low shadow-sm">
              {t('workflow.inspector.noConditionBranches', {
                defaultValue:
                  'No outgoing targets. Connect this Condition to downstream nodes to create branch rows.',
              })}
            </div>
          ) : null}
          {branches.map((branch, index) => {
            const usedTargetIds = new Set(
              branches
                .map((candidate, branchIndex) =>
                  branchIndex === index ? null : candidate.target_node_id
                )
                .filter((targetId): targetId is string => Boolean(targetId))
            );
            const updateBranch = (
              updates: Partial<WorkflowConditionBranch>
            ) => {
              const nextBranches = [...branches];
              nextBranches[index] = {
                ...nextBranches[index],
                ...updates,
              };
              handleChange('branches', nextBranches);
            };

            return (
              <div
                key={branch.id ?? branch.target_node_id ?? index}
                title={
                  branch.target_node_id
                    ? t('workflow.inspector.nodeIdTitle', {
                        nodeId: branch.target_node_id,
                        defaultValue: `Node ID: ${branch.target_node_id}`,
                      })
                    : undefined
                }
                className="flex flex-col gap-2 rounded-md border border-secondary/60 bg-primary/50 p-3 shadow-sm"
              >
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-high">
                    {t('workflow.inspector.branchTarget', {
                      defaultValue: 'Target',
                    })}
                  </label>
                  <select
                    className={inputClass}
                    value={branch.target_node_id ?? ''}
                    onChange={(event) =>
                      updateBranch({ target_node_id: event.target.value })
                    }
                    disabled={readOnly}
                  >
                    {!branch.target_node_id ? (
                      <option value="">
                        {t('workflow.inspector.selectTarget', {
                          defaultValue: 'Select target',
                        })}
                      </option>
                    ) : null}
                    {conditionBranchTargets.map((target) => (
                      <option
                        key={target.nodeId}
                        value={target.nodeId}
                        disabled={usedTargetIds.has(target.nodeId)}
                      >
                        {target.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-high">
                    {t('workflow.inspector.branchCondition', {
                      defaultValue: 'Route when',
                    })}
                  </label>
                  <textarea
                    className={inputClass}
                    rows={3}
                    value={branch.condition ?? ''}
                    placeholder={t(
                      'workflow.inspector.branchConditionPlaceholder',
                      {
                        defaultValue:
                          'Example: upstream output mentions UI, layout, style, or interaction changes',
                      }
                    )}
                    onChange={(event) =>
                      updateBranch({ condition: event.target.value })
                    }
                    disabled={readOnly}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {type === 'arena' && hasArenaAttempts && (
        <>
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-semibold text-high">
              {t('workflow.inspector.attempts')}
            </label>
            <button
              type="button"
              className={secondaryButtonClass}
              disabled={readOnly}
              onClick={() =>
                handleChange('attempts', [
                  ...attempts,
                  {
                    id: `attempt-${attempts.length + 1}`,
                    display_name: t('workflow.inspector.attemptLabel', {
                      index: attempts.length + 1,
                    }),
                    role_template_id: 'custom',
                    prompt_template: '',
                  },
                ])
              }
            >
              <Plus className="h-3.5 w-3.5" />
              {t('workflow.inspector.addAttempt')}
            </button>
          </div>
          {attempts.map((attempt, i) => (
            <div
              key={attempt.id ?? i}
              className="mt-2 flex flex-col gap-2 rounded-md border border-secondary/60 bg-primary/50 p-3 shadow-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-semibold text-high">
                  {attempt.display_name ??
                    t('workflow.inspector.attemptLabel', { index: i + 1 })}
                </label>
                <button
                  type="button"
                  className={iconButtonClass}
                  aria-label={t('workflow.inspector.removeAttempt', {
                    index: i + 1,
                  })}
                  disabled={readOnly || attempts.length <= 1}
                  onClick={() =>
                    handleChange(
                      'attempts',
                      attempts.filter((_, index) => index !== i)
                    )
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <input
                type="text"
                placeholder={t('workflow.fields.display_name')}
                className={inputClass}
                value={attempt.display_name ?? ''}
                onChange={(e) => {
                  const newAttempts = [...attempts];
                  newAttempts[i] = {
                    ...newAttempts[i],
                    display_name: e.target.value,
                  };
                  handleChange('attempts', newAttempts);
                }}
                disabled={readOnly}
              />
              <input
                type="text"
                placeholder={t('workflow.fields.role_template_id')}
                className={inputClass}
                value={attempt.role_template_id ?? ''}
                onChange={(e) => {
                  const newAttempts = [...attempts];
                  newAttempts[i] = {
                    ...newAttempts[i],
                    role_template_id: e.target.value,
                  };
                  handleChange('attempts', newAttempts);
                }}
                disabled={readOnly}
              />
              <textarea
                placeholder={t('workflow.inspector.promptOverride')}
                className={inputClass}
                rows={2}
                value={attempt.prompt_template ?? ''}
                onChange={(e) => {
                  const newAttempts = [...attempts];
                  newAttempts[i] = {
                    ...newAttempts[i],
                    prompt_template: e.target.value,
                  };
                  handleChange('attempts', newAttempts);
                }}
                disabled={readOnly}
              />
            </div>
          ))}
        </>
      )}
    </div>
  );
}
