import { useCallback, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { LogIn, type LucideIcon } from 'lucide-react';
import { OAuthDialog } from '@/shared/dialogs/global/OAuthDialog';

import { Button } from '@vibe/ui/components/Button';
import { PermissionState } from '@vibe/ui/components/StateSurface';
import { cn } from '@/shared/lib/utils';

interface LoginRequiredPromptProps {
  className?: string;
  buttonVariant?: ComponentProps<typeof Button>['variant'];
  buttonSize?: ComponentProps<typeof Button>['size'];
  buttonClassName?: string;
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: LucideIcon;
}

export function LoginRequiredPrompt({
  className,
  buttonVariant = 'outline',
  buttonSize = 'sm',
  buttonClassName,
  title,
  description,
  actionLabel,
  onAction,
  icon,
}: LoginRequiredPromptProps) {
  const { t } = useTranslation('tasks');

  const handleRedirect = useCallback(() => {
    if (onAction) {
      onAction();
      return;
    }
    void OAuthDialog.show({});
  }, [onAction]);

  const Icon = icon ?? LogIn;

  return (
    <PermissionState
      className={className}
      icon={<Icon />}
      title={title ?? t('shareDialog.loginRequired.title')}
      description={description ?? t('shareDialog.loginRequired.description')}
      action={
        <Button
          variant={buttonVariant}
          size={buttonSize}
          onClick={handleRedirect}
          className={cn('min-h-11 gap-2', buttonClassName)}
        >
          <Icon className="h-4 w-4" />
          {actionLabel ?? t('shareDialog.loginRequired.action')}
        </Button>
      }
    />
  );
}
