import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadingState } from '@vibe/ui/components/StateSurface';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';

export function WorkspacesLanding() {
  const appNavigation = useAppNavigation();
  const { t } = useTranslation('common');

  useEffect(() => {
    appNavigation.goToWorkspacesCreate({
      replace: true,
    });
  }, [appNavigation]);

  return (
    <div className="flex h-full flex-1 items-center justify-center bg-primary">
      <LoadingState
        title={t('workspaces.openingTitle', {
          defaultValue: 'Opening a new workspace',
        })}
      />
    </div>
  );
}
