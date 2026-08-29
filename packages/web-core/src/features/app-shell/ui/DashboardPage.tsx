import type { ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react';

interface DashboardSectionProps {
  title: string;
  icon: typeof Activity;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?(): void;
  children: ReactNode;
}

function DashboardSection({
  title,
  icon: Icon,
  isLoading,
  isError,
  onRetry,
  children,
}: DashboardSectionProps) {
  return (
    <section className="vk-dashboard-card">
      <header>
        <Icon aria-hidden="true" size={17} />
        <h2>{title}</h2>
      </header>
      {isLoading ? (
        <p className="vk-dashboard-state" role="status">
          <LoaderCircle className="vk-spin" aria-hidden="true" size={16} />
          Loading…
        </p>
      ) : isError ? (
        <button type="button" className="vk-dashboard-state" onClick={onRetry}>
          <RefreshCw aria-hidden="true" size={16} />
          Retry this section
        </button>
      ) : (
        children
      )}
    </section>
  );
}

function Unavailable({ children }: { children: ReactNode }) {
  return (
    <p className="vk-dashboard-state" data-state="unavailable">
      {children}
    </p>
  );
}

export function DashboardPage() {
  return (
    <div className="vk-dashboard">
      <header className="vk-dashboard__header">
        <p>Overview</p>
        <h1>Dashboard</h1>
        <span>Current projects, sessions and runtime availability.</span>
      </header>

      <div className="vk-dashboard__grid">
        <DashboardSection title="Global statistics" icon={Activity}>
          <Unavailable>
            Canonical Project, Issue, and Agent-run totals are not exposed yet.
            Paged sidebar rows are intentionally not presented as global
            statistics.
          </Unavailable>
        </DashboardSection>

        <DashboardSection title="Attention" icon={AlertTriangle}>
          <Unavailable>
            No canonical attention projection is available yet. This section
            stays independent and does not infer alerts from log text.
          </Unavailable>
        </DashboardSection>

        <DashboardSection title="Active runs" icon={Activity}>
          <Unavailable>
            Session list data does not expose runtime state. Active runs will
            appear here when the canonical runtime projection provides it.
          </Unavailable>
        </DashboardSection>

        <DashboardSection title="Agent configuration" icon={Bot}>
          <Unavailable>
            Canonical connection, default model, API endpoint, and running-count
            summaries are not exposed yet. Runtime API capabilities are not
            configuration data and are not substituted here.
          </Unavailable>
        </DashboardSection>
      </div>
    </div>
  );
}
