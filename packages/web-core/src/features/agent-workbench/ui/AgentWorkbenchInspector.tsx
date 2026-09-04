import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { RepoWithTargetBranch, Workspace } from 'shared/types';

import { TerminalPanelContainer } from '@/shared/components/TerminalPanelContainer';
import { cn } from '@/shared/lib/utils';
import {
  RIGHT_MAIN_PANEL_MODES,
  type RightMainPanelMode,
} from '@/shared/stores/useUiPreferencesStore';
import { ChangesPanelContainer } from '@/pages/workspaces/ChangesPanelContainer';
import { GitPanelContainer } from '@/pages/workspaces/GitPanelContainer';
import { LogsContentContainer } from '@/pages/workspaces/LogsContentContainer';
import { PreviewBrowserContainer } from '@/pages/workspaces/PreviewBrowserContainer';
import { WorkspaceFilesSurfaceContainer } from '@/pages/workspaces/WorkspaceFilesSurfaceContainer';
import {
  AGENT_WORKBENCH_INSPECTOR_TABS,
  type AgentWorkbenchInspectorTab,
} from '../model';
import { useAgentWorkbenchInspectorVisibility } from './AgentWorkbenchInspectorVisibility';

function modeToTab(
  mode: RightMainPanelMode | null
): AgentWorkbenchInspectorTab | null {
  switch (mode) {
    case RIGHT_MAIN_PANEL_MODES.CHANGES:
      return 'changes';
    case RIGHT_MAIN_PANEL_MODES.FILES:
      return 'files';
    case RIGHT_MAIN_PANEL_MODES.LOGS:
      return 'logs';
    case RIGHT_MAIN_PANEL_MODES.PREVIEW:
      return 'preview';
    case null:
      return null;
  }
}

function tabToMode(tab: AgentWorkbenchInspectorTab): RightMainPanelMode | null {
  switch (tab) {
    case 'changes':
      return RIGHT_MAIN_PANEL_MODES.CHANGES;
    case 'files':
      return RIGHT_MAIN_PANEL_MODES.FILES;
    case 'logs':
      return RIGHT_MAIN_PANEL_MODES.LOGS;
    case 'preview':
      return RIGHT_MAIN_PANEL_MODES.PREVIEW;
    case 'git':
    case 'terminal':
      return null;
  }
}

export interface AgentWorkbenchInspectorProps {
  workspace: Workspace | undefined;
  repos: RepoWithTargetBranch[];
  rightMainPanelMode: RightMainPanelMode | null;
  onRightMainPanelModeChange: (mode: RightMainPanelMode | null) => void;
  activeTabOverride?: AgentWorkbenchInspectorTab;
}

export function AgentWorkbenchInspector({
  workspace,
  repos,
  rightMainPanelMode,
  onRightMainPanelModeChange,
  activeTabOverride,
}: AgentWorkbenchInspectorProps) {
  const { t } = useTranslation('common');
  const tabsId = useId();
  const inspectorVisible = useAgentWorkbenchInspectorVisibility();
  const storageKey = `vk-agent-workbench-inspector-tab:${workspace?.id ?? 'none'}`;
  const [activeTab, setActiveTab] = useState<AgentWorkbenchInspectorTab>(
    modeToTab(rightMainPanelMode) ?? 'changes'
  );

  useEffect(() => {
    if (activeTabOverride) {
      setActiveTab(activeTabOverride);
      return;
    }
    const next = modeToTab(rightMainPanelMode);
    if (next) setActiveTab(next);
  }, [activeTabOverride, rightMainPanelMode]);

  useEffect(() => {
    if (activeTabOverride) return;
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (
        saved &&
        AGENT_WORKBENCH_INSPECTOR_TABS.includes(
          saved as AgentWorkbenchInspectorTab
        )
      ) {
        setActiveTab(saved as AgentWorkbenchInspectorTab);
      }
    } catch {
      // The Inspector remains usable when host storage is unavailable.
    }
  }, [activeTabOverride, storageKey]);

  const panels = useMemo(
    () => ({
      changes: workspace?.id ? (
        <ChangesPanelContainer className="" workspaceId={workspace.id} />
      ) : null,
      files: workspace?.id ? (
        <WorkspaceFilesSurfaceContainer
          className=""
          workspaceId={workspace.id}
        />
      ) : null,
      git: <GitPanelContainer selectedWorkspace={workspace} repos={repos} />,
      terminal: <TerminalPanelContainer />,
      preview: workspace?.id ? (
        <PreviewBrowserContainer workspaceId={workspace.id} className="" />
      ) : null,
      logs: <LogsContentContainer className="" />,
    }),
    [repos, workspace]
  );
  const tabLabels = useMemo<Record<AgentWorkbenchInspectorTab, string>>(
    () => ({
      changes: t('agentWorkbench.inspector.tabs.changes', {
        defaultValue: 'Changes',
      }),
      files: t('agentWorkbench.inspector.tabs.files', {
        defaultValue: 'Files',
      }),
      git: t('agentWorkbench.inspector.tabs.git', { defaultValue: 'Git' }),
      terminal: t('agentWorkbench.inspector.tabs.terminal', {
        defaultValue: 'Terminal',
      }),
      preview: t('agentWorkbench.inspector.tabs.preview', {
        defaultValue: 'Preview',
      }),
      logs: t('agentWorkbench.inspector.tabs.logs', { defaultValue: 'Logs' }),
    }),
    [t]
  );

  const selectTab = (tab: AgentWorkbenchInspectorTab) => {
    setActiveTab(tab);
    onRightMainPanelModeChange(tabToMode(tab));
    try {
      window.localStorage.setItem(storageKey, tab);
    } catch {
      // Preference persistence is best effort.
    }
  };

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    tab: AgentWorkbenchInspectorTab
  ) => {
    const currentIndex = AGENT_WORKBENCH_INSPECTOR_TABS.indexOf(tab);
    let nextIndex: number | null = null;
    switch (event.key) {
      case 'ArrowLeft':
        nextIndex =
          (currentIndex - 1 + AGENT_WORKBENCH_INSPECTOR_TABS.length) %
          AGENT_WORKBENCH_INSPECTOR_TABS.length;
        break;
      case 'ArrowRight':
        nextIndex = (currentIndex + 1) % AGENT_WORKBENCH_INSPECTOR_TABS.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = AGENT_WORKBENCH_INSPECTOR_TABS.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    const nextTab = AGENT_WORKBENCH_INSPECTOR_TABS[nextIndex];
    selectTab(nextTab);
    document.getElementById(`${tabsId}-tab-${nextTab}`)?.focus();
  };

  return (
    <div className="vk-agent-workbench-inspector flex h-full min-h-0 flex-col border-l bg-secondary">
      <div
        className="flex shrink-0 gap-1 overflow-x-auto border-b p-1"
        role="tablist"
        aria-label={t('agentWorkbench.inspector.label', {
          defaultValue: 'Inspector',
        })}
      >
        {AGENT_WORKBENCH_INSPECTOR_TABS.map((tab) => (
          <button
            key={tab}
            id={`${tabsId}-tab-${tab}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`${tabsId}-panel-${tab}`}
            tabIndex={activeTab === tab ? 0 : -1}
            className={cn(
              'min-h-9 shrink-0 rounded px-2 text-xs text-muted-foreground',
              'hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
              activeTab === tab && 'bg-accent text-foreground'
            )}
            onClick={() => selectTab(tab)}
            onKeyDown={(event) => handleTabKeyDown(event, tab)}
          >
            {tabLabels[tab]}
          </button>
        ))}
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          id={`${tabsId}-panel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`${tabsId}-tab-${activeTab}`}
          className="absolute inset-0 min-h-0 overflow-hidden"
        >
          {inspectorVisible ? panels[activeTab] : null}
        </div>
      </div>
    </div>
  );
}
