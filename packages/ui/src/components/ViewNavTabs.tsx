'use client';

import { useTranslation } from 'react-i18next';
import { cn } from '../lib/cn';
import { ButtonGroup, ButtonGroupItem } from './IconButtonGroup';

export type ViewNavMode = 'kanban' | 'list';

export type ViewNavStatus = {
  id: string;
  name: string;
};

export interface ViewNavTabsProps {
  activeView: ViewNavMode;
  onViewChange: (view: ViewNavMode) => void;
  hiddenStatuses: ViewNavStatus[];
  selectedStatusId: string | null;
  onStatusSelect: (statusId: string | null) => void;
  className?: string;
}

export function ViewNavTabs({
  activeView,
  onViewChange,
  hiddenStatuses,
  selectedStatusId,
  onStatusSelect,
  className,
}: ViewNavTabsProps) {
  const { t } = useTranslation('common');
  const isActiveTab = activeView === 'kanban';
  const isAllTab = activeView === 'list' && selectedStatusId === null;

  return (
    <div className="scrollbar-none flex min-w-0 items-center gap-base overflow-x-auto overflow-y-hidden">
      <ButtonGroup className={cn('shrink-0', className)}>
        {/* Active (Kanban) tab */}
        <ButtonGroupItem
          active={isActiveTab}
          onClick={() => {
            onViewChange('kanban');
            onStatusSelect(null);
          }}
          className="shrink-0 whitespace-nowrap"
        >
          {t('kanban.viewTabs.active')}
        </ButtonGroupItem>

        {/* All (List) tab */}
        <ButtonGroupItem
          active={isAllTab}
          onClick={() => {
            onViewChange('list');
            onStatusSelect(null);
          }}
          className="shrink-0 whitespace-nowrap"
        >
          {t('kanban.viewTabs.all')}
        </ButtonGroupItem>

        {/* Hidden status tabs */}
        {hiddenStatuses.map((status) => {
          const isStatusActive =
            activeView === 'list' && selectedStatusId === status.id;
          return (
            <ButtonGroupItem
              key={status.id}
              active={isStatusActive}
              onClick={() => {
                onViewChange('list');
                onStatusSelect(status.id);
              }}
              className="shrink-0 whitespace-nowrap"
            >
              {status.name}
            </ButtonGroupItem>
          );
        })}
      </ButtonGroup>
    </div>
  );
}
