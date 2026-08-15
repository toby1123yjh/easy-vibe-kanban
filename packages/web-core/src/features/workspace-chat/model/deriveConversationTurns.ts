import { type CommandExitStatus, type ToolStatus } from 'shared/types';

import type { ConversationSemanticProcessItem } from './deriveConversationSemanticTimeline';
import { deriveConversationSemanticTimeline } from './deriveConversationSemanticTimeline';
import type { ConversationTimelineSource } from '@/shared/hooks/useConversationHistory/types';

type ScriptTurnKind =
  | 'setup_script'
  | 'cleanup_script'
  | 'archive_script'
  | 'tool_install_script';

export interface ConversationScriptTurnProcess {
  readonly process: ConversationSemanticProcessItem;
  readonly toolName: string;
  readonly exitStatus: CommandExitStatus | null;
  readonly toolStatus: ToolStatus;
  readonly shouldEmitInitialPromptAfterSetup: boolean;
  readonly initialPromptAfterSetup: string | null;
}

export interface ConversationScriptTurn {
  readonly key: string;
  readonly kind: ScriptTurnKind;
  readonly processes: ReadonlyArray<ConversationScriptTurnProcess>;
}

export type ConversationTurn = ConversationScriptTurn;

export interface ConversationTurns {
  readonly turns: ConversationTurn[];
  readonly hasSetupScriptProcess: boolean;
  readonly hasSetupScriptWithPrompt: boolean;
}

// Turns are the first product-shaped model in the pipeline. Agent turns come
// exclusively from the canonical AgentRun projection; this model only groups
// standalone ExecutionProcess script output.

function toScriptTurnKind(
  process: ConversationSemanticProcessItem
): ScriptTurnKind | null {
  const action = process.executionProcess.executor_action.typ;
  if (action.type !== 'ScriptRequest') return null;

  switch (action.context) {
    case 'SetupScript':
      return 'setup_script';
    case 'CleanupScript':
      return 'cleanup_script';
    case 'ArchiveScript':
      return 'archive_script';
    case 'ToolInstallScript':
      return 'tool_install_script';
    default:
      return null;
  }
}

function toScriptToolName(kind: ScriptTurnKind): string {
  switch (kind) {
    case 'setup_script':
      return 'Setup Script';
    case 'cleanup_script':
      return 'Cleanup Script';
    case 'archive_script':
      return 'Archive Script';
    case 'tool_install_script':
      return 'Tool Install Script';
  }
}

function deriveScriptTurnProcess(
  process: ConversationSemanticProcessItem,
  kind: ScriptTurnKind
): ConversationScriptTurnProcess {
  const exitCode = Number(process.liveExecutionProcess?.exit_code) || 0;
  const exitStatus: CommandExitStatus | null = process.isRunning
    ? null
    : {
        type: 'exit_code',
        code: exitCode,
      };
  const toolStatus: ToolStatus = process.isRunning
    ? { status: 'created' }
    : exitCode === 0
      ? { status: 'success' }
      : { status: 'failed' };

  const shouldEmitInitialPromptAfterSetup = false;

  return {
    process,
    toolName: toScriptToolName(kind),
    exitStatus,
    toolStatus,
    shouldEmitInitialPromptAfterSetup,
    initialPromptAfterSetup: null,
  };
}

export function deriveConversationTurns(
  source: ConversationTimelineSource
): ConversationTurns {
  const semanticTimeline = deriveConversationSemanticTimeline(source);
  const turns: ConversationTurn[] = [];
  const typedProcesses = semanticTimeline.processes
    .map((process) => {
      const scriptKind = toScriptTurnKind(process);
      return {
        process,
        scriptKind,
      };
    })
    .filter(
      (
        item
      ): item is {
        process: ConversationSemanticProcessItem;
        scriptKind: ScriptTurnKind | null;
      } => item.scriptKind !== null
    );

  for (const item of typedProcesses) {
    const kind = item.scriptKind;
    if (!kind) continue;

    const previousTurn = turns.at(-1);
    if (previousTurn && previousTurn.kind === kind) {
      turns[turns.length - 1] = {
        ...previousTurn,
        processes: [
          ...previousTurn.processes,
          deriveScriptTurnProcess(item.process, kind),
        ],
      };
      continue;
    }

    turns.push({
      key: item.process.executionProcessId,
      kind,
      processes: [deriveScriptTurnProcess(item.process, kind)],
    });
  }

  return {
    turns,
    hasSetupScriptProcess: semanticTimeline.hasSetupScriptProcess,
    hasSetupScriptWithPrompt: semanticTimeline.hasSetupScriptWithPrompt,
  };
}
