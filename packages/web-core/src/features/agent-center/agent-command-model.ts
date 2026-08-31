import type {
  AgentCommandDefinitionView,
  AgentCommandFormat,
  AgentCommandLocator,
  AgentCommandProvider,
  AgentCommandScope,
  AgentCommandView,
  AgentCommandWriteDefinition,
  OptionalCommandTextWrite,
} from 'shared/types';

export type CommandEditorState = {
  mode: 'add' | 'edit';
  item: AgentCommandView | null;
  scope: AgentCommandScope;
  format: AgentCommandFormat;
  name: string;
  description: string;
  argumentHint: string;
  body: string;
  dirty: boolean;
  validationError: string | null;
  revisionConflict: boolean;
};

export function locatorFor(
  item: AgentCommandView,
  projectPath: string
): AgentCommandLocator {
  return {
    provider: item.provider,
    scope: item.scope,
    name: item.name,
    installation_id: item.installation_id,
    project_path: item.scope === 'project' ? projectPath : undefined,
  };
}

function optionalText(value: string): OptionalCommandTextWrite {
  return value.length > 0
    ? { type: 'replace', data: { value } }
    : { type: 'clear' };
}

export function writeDefinition(
  editor: CommandEditorState
): AgentCommandWriteDefinition {
  const description = optionalText(editor.description.trim());
  const body = { type: 'replace' as const, data: { value: editor.body } };

  switch (editor.format) {
    case 'codex_legacy_markdown':
      return {
        type: 'codex_legacy',
        data: {
          description,
          argument_hint: optionalText(editor.argumentHint.trim()),
          body,
        },
      };
    case 'claude_markdown':
      return { type: 'claude_code', data: { description, body } };
    case 'gemini_toml':
      return {
        type: 'gemini',
        data: { description, prompt: body },
      };
    case 'oh_my_pi_prompt_markdown':
      return { type: 'oh_my_pi_prompt', data: { description, body } };
    case 'oh_my_pi_executable_module':
      throw new Error('read_only_format');
  }
}

export function editorFromItem(item: AgentCommandView): CommandEditorState {
  const definition = item.definition;
  let description = '';
  let argumentHint = '';
  let body = '';

  switch (definition.type) {
    case 'codex_legacy':
      description = definition.data.description ?? '';
      argumentHint = definition.data.argument_hint ?? '';
      body = definition.data.body;
      break;
    case 'claude_code':
      description = definition.data.description ?? '';
      body = definition.data.body;
      break;
    case 'gemini':
      description = definition.data.description ?? '';
      body = definition.data.prompt;
      break;
    case 'oh_my_pi_prompt':
      description = definition.data.description ?? '';
      body = definition.data.body;
      break;
    case 'oh_my_pi_executable':
    case 'invalid':
      break;
  }

  return {
    mode: 'edit',
    item,
    scope: item.scope,
    format: item.format,
    name: item.name,
    description,
    argumentHint,
    body,
    dirty: false,
    validationError: null,
    revisionConflict: false,
  };
}

export function definitionDescription(
  definition: AgentCommandDefinitionView
): string | null {
  switch (definition.type) {
    case 'codex_legacy':
    case 'claude_code':
    case 'gemini':
    case 'oh_my_pi_prompt':
      return definition.data.description ?? null;
    case 'oh_my_pi_executable':
    case 'invalid':
      return null;
  }
}

export function commandNameIsValid(
  provider: AgentCommandProvider,
  name: string
) {
  const segmentPattern = /^[A-Za-z0-9_-]+$/;
  const segments = name.split(':');
  if (segments.some((segment) => !segmentPattern.test(segment))) return false;
  return (
    provider === 'claude_code' || provider === 'gemini' || segments.length === 1
  );
}
