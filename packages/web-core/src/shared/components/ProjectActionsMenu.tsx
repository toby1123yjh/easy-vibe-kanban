import { MoreHorizontal, Settings, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@vibe/ui/components/DropdownMenu';

export function ProjectActionsMenu({
  projectName,
  className,
  disabled,
  onSettings,
  onDelete,
}: {
  projectName: string;
  className: string;
  disabled?: boolean;
  onSettings?(): void;
  onDelete(): void;
}) {
  const { t } = useTranslation('projects');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={className}
          disabled={disabled}
          onClick={(event) => event.stopPropagation()}
          aria-label={t('directory.moreActions', {
            name: projectName,
            defaultValue: 'More actions for {{name}}',
          })}
        >
          <MoreHorizontal aria-hidden="true" size={17} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onSettings && (
          <DropdownMenuItem
            onSelect={(event) => {
              event.stopPropagation();
              onSettings();
            }}
          >
            <Settings aria-hidden="true" size={15} />
            {t('directory.projectSettings', 'Project settings')}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onSelect={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          className="text-error focus:text-error"
        >
          <Trash2 aria-hidden="true" size={15} />
          {t('common:buttons.delete', 'Delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
