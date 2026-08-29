import type { SessionListItem } from 'shared/types';

import {
  buildWorkspaceContext,
  type BuildWorkspaceContextOptions,
} from '@/shared/lib/workspaceContext';

export interface AgentWorkbenchHeader {
  readonly title: string;
  readonly subtitle: string | undefined;
}

export function deriveAgentWorkbenchHeader({
  canonicalSession,
  fallbackTitle,
  issueLabel,
  workspaceContext,
}: {
  canonicalSession: SessionListItem | undefined;
  fallbackTitle: string;
  issueLabel?: string;
  workspaceContext?: BuildWorkspaceContextOptions;
}): AgentWorkbenchHeader {
  const contextLabels = [
    issueLabel?.trim() || undefined,
    ...(workspaceContext ? buildWorkspaceContext(workspaceContext) : []).map(
      (part) => part.label
    ),
  ].filter((label): label is string => Boolean(label));

  return {
    title: canonicalSession?.title.trim() || fallbackTitle,
    subtitle: contextLabels.length > 0 ? contextLabels.join(' / ') : undefined,
  };
}
