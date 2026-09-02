import { useState } from 'react';
import { WarningIcon, ArrowClockwiseIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';
import { StateSurface } from './StateSurface';

export interface CrashScreenProps {
  error?: Error | string;
  componentStack?: string | null;
  onReload?: () => void;
}

export function CrashScreen({
  error,
  componentStack,
  onReload,
}: CrashScreenProps) {
  const { t } = useTranslation('common');
  const [showDetails, setShowDetails] = useState(false);

  const errorMessage =
    error instanceof Error ? error.message : (error ?? undefined);
  const hasDetails = !!(errorMessage || componentStack);

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-primary p-double font-ibm-plex-sans">
      <StateSurface
        state="error"
        className="w-full max-w-md"
        icon={<WarningIcon className="size-12" weight="fill" />}
        title={<h1>{t('crashScreen.title')}</h1>}
        description={t('crashScreen.description')}
        action={
          <div className="flex w-full flex-col items-center gap-base">
            <Button
              type="button"
              onClick={() => (onReload ?? (() => window.location.reload()))()}
            >
              <ArrowClockwiseIcon
                aria-hidden="true"
                className="size-icon-base"
                weight="bold"
              />
              {t('crashScreen.reload')}
            </Button>

            {hasDetails && (
              <div className="w-full">
                <Button
                  type="button"
                  variant="ghost"
                  aria-expanded={showDetails}
                  onClick={() => setShowDetails((value) => !value)}
                >
                  {showDetails
                    ? t('crashScreen.hideDetails')
                    : t('crashScreen.showDetails')}
                </Button>

                {showDetails && (
                  <pre className="mt-half max-h-48 w-full overflow-auto rounded-sm bg-secondary p-base text-left text-xs text-low">
                    {errorMessage}
                    {componentStack && `\n\nComponent stack:${componentStack}`}
                  </pre>
                )}
              </div>
            )}
          </div>
        }
      />
    </div>
  );
}
