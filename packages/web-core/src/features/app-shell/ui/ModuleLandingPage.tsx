import { Bot, FolderKanban, GitBranch, type LucideIcon } from 'lucide-react';

type ModuleLandingKind = 'projects' | 'workflows' | 'agents';

const MODULE_COPY: Record<
  ModuleLandingKind,
  { title: string; description: string; icon: LucideIcon }
> = {
  projects: {
    title: 'Projects',
    description:
      'Choose a project from the sidebar to open its existing Kanban view.',
    icon: FolderKanban,
  },
  workflows: {
    title: 'Workflows',
    description:
      'Workflow authoring remains project-scoped. Open a project, then choose its workflow surface.',
    icon: GitBranch,
  },
  agents: {
    title: 'Agents',
    description:
      'Agent availability comes from the connected host. Configuration pages will consume the same adapter capabilities.',
    icon: Bot,
  },
};

export function ModuleLandingPage({ kind }: { kind: ModuleLandingKind }) {
  const copy = MODULE_COPY[kind];
  const Icon = copy.icon;
  return (
    <section className="vk-module-landing">
      <Icon aria-hidden="true" size={24} />
      <p>Product module</p>
      <h1>{copy.title}</h1>
      <span>{copy.description}</span>
    </section>
  );
}
