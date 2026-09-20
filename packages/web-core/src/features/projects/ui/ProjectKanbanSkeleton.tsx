import { useTranslation } from 'react-i18next';
import './project-surfaces.css';

/** Use the board's actual geometry throughout initial project resolution. */
export function ProjectKanbanSkeleton({
  projectName,
}: {
  projectName?: string;
}) {
  const { t } = useTranslation('common');
  return (
    <section
      className="vk-project-kanban"
      aria-busy="true"
      aria-label={t('states.loading')}
    >
      <header className="vk-project-kanban__toolbar">
        <div className="vk-project-kanban__identity">
          {projectName ? (
            <strong>{projectName}</strong>
          ) : (
            <div className="vk-kanban-skeleton-line" />
          )}
        </div>
      </header>
      <div className="vk-kanban-scroll" aria-hidden="true">
        <div className="vk-kanban-columns">
          {[0, 1, 2, 3, 4].map((column) => (
            <div className="vk-kanban-column" key={column}>
              <header className="vk-kanban-column__header">
                <div className="vk-kanban-skeleton-line" />
              </header>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
