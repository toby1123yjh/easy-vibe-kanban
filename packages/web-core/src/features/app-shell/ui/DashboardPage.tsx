import { useId, type ReactNode } from 'react';
import { Activity, AlertTriangle, Bot } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface DashboardSectionProps {
  title: string;
  icon: typeof Activity;
  children: ReactNode;
}

function DashboardSection({
  title,
  icon: Icon,
  children,
}: DashboardSectionProps) {
  const titleId = useId();

  return (
    <section className="vk-dashboard-card" aria-labelledby={titleId}>
      <header>
        <Icon aria-hidden="true" size={17} />
        <h2 id={titleId}>{title}</h2>
      </header>
      {children}
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
  const titleId = useId();
  const { t } = useTranslation('common');

  return (
    <div
      className="vk-dashboard"
      data-testid="dashboard-page"
      role="region"
      aria-labelledby={titleId}
    >
      <header className="vk-dashboard__header">
        <p>{t('appShell.dashboard.eyebrow')}</p>
        <h1 id={titleId}>{t('appShell.dashboard.title')}</h1>
        <span>{t('appShell.dashboard.subtitle')}</span>
      </header>

      <div className="vk-dashboard__grid">
        <DashboardSection
          title={t('appShell.dashboard.sections.globalStatistics')}
          icon={Activity}
        >
          <Unavailable>
            {t('appShell.dashboard.unavailable.globalStatistics')}
          </Unavailable>
        </DashboardSection>

        <DashboardSection
          title={t('appShell.dashboard.sections.attention')}
          icon={AlertTriangle}
        >
          <Unavailable>
            {t('appShell.dashboard.unavailable.attention')}
          </Unavailable>
        </DashboardSection>

        <DashboardSection
          title={t('appShell.dashboard.sections.activeRuns')}
          icon={Activity}
        >
          <Unavailable>
            {t('appShell.dashboard.unavailable.activeRuns')}
          </Unavailable>
        </DashboardSection>

        <DashboardSection
          title={t('appShell.dashboard.sections.agentConfiguration')}
          icon={Bot}
        >
          <Unavailable>
            {t('appShell.dashboard.unavailable.agentConfiguration')}
          </Unavailable>
        </DashboardSection>
      </div>
    </div>
  );
}
