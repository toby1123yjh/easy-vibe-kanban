import { Bot, FolderKanban, GitBranch, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type ModuleLandingKind = 'projects' | 'workflows' | 'agents';

const MODULE_COPY: Record<
  ModuleLandingKind,
  {
    titleKey: `appShell.modules.${ModuleLandingKind}`;
    descriptionKey: `appShell.moduleLanding.${ModuleLandingKind}Description`;
    icon: LucideIcon;
  }
> = {
  projects: {
    titleKey: 'appShell.modules.projects',
    descriptionKey: 'appShell.moduleLanding.projectsDescription',
    icon: FolderKanban,
  },
  workflows: {
    titleKey: 'appShell.modules.workflows',
    descriptionKey: 'appShell.moduleLanding.workflowsDescription',
    icon: GitBranch,
  },
  agents: {
    titleKey: 'appShell.modules.agents',
    descriptionKey: 'appShell.moduleLanding.agentsDescription',
    icon: Bot,
  },
};

export function ModuleLandingPage({ kind }: { kind: ModuleLandingKind }) {
  const copy = MODULE_COPY[kind];
  const Icon = copy.icon;
  const { t } = useTranslation('common');
  return (
    <section className="vk-module-landing">
      <Icon aria-hidden="true" size={24} />
      <p>{t('appShell.moduleLanding.eyebrow')}</p>
      <h1>{t(copy.titleKey)}</h1>
      <span>{t(copy.descriptionKey)}</span>
    </section>
  );
}
