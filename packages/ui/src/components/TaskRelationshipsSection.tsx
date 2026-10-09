'use client';

import { useTranslation } from 'react-i18next';
import { XIcon } from '@phosphor-icons/react';
import { CollapsibleSectionHeader } from './CollapsibleSectionHeader';
import {
  RelationshipBadge,
  type RelationshipDisplayType,
} from './RelationshipBadge';

export interface TaskRelationshipsSectionRelationship {
  relationshipId: string;
  relatedTaskId: string;
  relatedTaskDisplayId: string;
  displayType: RelationshipDisplayType;
}

export interface TaskRelationshipsSectionProps {
  relationships: TaskRelationshipsSectionRelationship[];
  onRelationshipClick: (relatedTaskId: string) => void;
  onRemoveRelationship?: (relationshipId: string) => void;
  isLoading?: boolean;
  headerExtra?: React.ReactNode;
}

export function TaskRelationshipsSection({
  relationships,
  onRelationshipClick,
  onRemoveRelationship,
  isLoading,
  headerExtra,
}: TaskRelationshipsSectionProps) {
  const { t } = useTranslation('common');

  return (
    <CollapsibleSectionHeader
      title={t('kanban.relationships', 'Relationships')}
      persistKey="kanban-issue-relationships"
      defaultExpanded={true}
      headerExtra={headerExtra}
    >
      <div className="p-base flex flex-col gap-half border-t">
        {isLoading ? (
          <p className="text-low py-half">{t('states.loading')}</p>
        ) : relationships.length === 0 ? (
          <p className="text-low py-half">
            {t('kanban.noRelationships', 'No relationships')}
          </p>
        ) : (
          relationships.map((rel) => (
            <div
              key={rel.relationshipId}
              className="flex items-center justify-between group"
            >
              <RelationshipBadge
                displayType={rel.displayType}
                relatedTaskDisplayId={rel.relatedTaskDisplayId}
                onClick={(e) => {
                  e.stopPropagation();
                  onRelationshipClick(rel.relatedTaskId);
                }}
              />
              {onRemoveRelationship && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveRelationship(rel.relationshipId);
                  }}
                  className="p-half rounded-sm text-low hover:text-error hover:bg-error/10 transition-colors opacity-0 group-hover:opacity-100"
                  aria-label="Remove relationship"
                >
                  <XIcon className="size-icon-2xs" weight="bold" />
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </CollapsibleSectionHeader>
  );
}
