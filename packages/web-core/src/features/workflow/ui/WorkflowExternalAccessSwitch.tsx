import { useEffect, useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Switch } from '@vibe/ui/components/Switch';
import { workflowApi } from '@/shared/lib/workflowApi';
import { workflowTemplateQueryKeys } from '@/shared/hooks/useWorkflowTemplates';

export function WorkflowExternalAccessSwitch({
  workflowId,
  enabled,
  disabled,
}: {
  workflowId: string;
  enabled: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  const id = useId();
  const lock = useRef(false);
  const mounted = useRef(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const toggle = async (next: boolean) => {
    if (lock.current || disabled) return;
    lock.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await workflowApi.setExternalAccess(workflowId, next);
      queryClient.setQueryData(
        workflowTemplateQueryKeys.detail(workflowId),
        result
      );
      await queryClient.invalidateQueries({
        queryKey: workflowTemplateQueryKeys.all,
      });
    } catch (cause) {
      if (mounted.current)
        setError(
          cause instanceof Error
            ? cause.message
            : t('externalIntegrations.failed')
        );
    } finally {
      lock.current = false;
      if (mounted.current) setPending(false);
    }
  };
  return (
    <div
      className="space-y-1"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <label
        htmlFor={id}
        className="flex min-h-9 items-center justify-between gap-3 text-base text-normal"
        title={t('externalIntegrations.externalHint')}
      >
        <span>{t('externalIntegrations.externalAllowed')}</span>
        <Switch
          id={id}
          checked={enabled}
          disabled={disabled || pending}
          aria-busy={pending}
          aria-describedby={`${id}-hint`}
          onCheckedChange={(next) => void toggle(next)}
        />
      </label>
      <p id={`${id}-hint`} className="sr-only">
        {t('externalIntegrations.externalHint')}
      </p>
      {error && (
        <p role="alert" className="text-base text-error">
          {error}
        </p>
      )}
    </div>
  );
}
