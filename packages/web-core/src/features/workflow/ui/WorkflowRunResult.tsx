import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { WorkflowRunResponse } from 'shared/types';
import { Button } from '@vibe/ui/components/Button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@vibe/ui/components/Dialog';
import { createWorkflowApi } from '@/shared/lib/workflowApi';
import { useHostId } from '@/shared/providers/HostIdProvider';

export function WorkflowRunResult({ run }: { run: WorkflowRunResponse }) {
  const { t } = useTranslation('settings');
  const hostId = useHostId();
  const scopedWorkflowApi = createWorkflowApi(hostId);
  const [open, setOpen] = useState(false);
  const active = !['succeeded', 'failed', 'canceled'].includes(run.status);
  const files = useQuery({
    queryKey: ['workflow-file-changes', hostId, run.id, active],
    queryFn: () => scopedWorkflowApi.fileChanges(run.id),
    enabled: open,
    refetchInterval: open && active ? 4000 : false,
  });
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {t('externalIntegrations.result')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-2xl"
          closeLabel={t('externalIntegrations.close')}
        >
          <DialogHeader>
            <DialogTitle>{t('externalIntegrations.result')}</DialogTitle>
            <DialogDescription>
              {t('externalIntegrations.resultHint')}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[65vh] space-y-4 overflow-y-auto">
            {run.output_text && (
              <p className="whitespace-pre-wrap break-words text-normal">
                {run.output_text}
              </p>
            )}
            {run.error_text && (
              <p className="whitespace-pre-wrap break-words text-error">
                {run.error_text}
              </p>
            )}
            <h3 className="font-medium text-high">
              {t('externalIntegrations.agentFiles')}
            </h3>
            {files.isPending && (
              <p role="status">{t('externalIntegrations.loading')}</p>
            )}
            {files.isError && (
              <div role="alert" className="space-y-2 text-error">
                <p>{t('externalIntegrations.filesFailed')}</p>
                <Button
                  variant="outline"
                  loading={files.isFetching}
                  onClick={() => void files.refetch()}
                >
                  {t('externalIntegrations.retry')}
                </Button>
              </div>
            )}
            {files.data && (
              <>
                <p className="text-base text-low" role="status">
                  {t(
                    `externalIntegrations.filesStatus.${files.data.collection_status}`
                  )}
                </p>
                <ul className="divide-y divide-border">
                  {files.data.files.map((file) => (
                    <li
                      key={`${file.change_type}:${file.path}`}
                      className="flex items-start gap-3 py-2 text-base"
                    >
                      <span className="shrink-0 rounded bg-secondary px-2 py-0.5 text-normal">
                        {t(`externalIntegrations.fileKind.${file.change_type}`)}
                      </span>
                      <span className="min-w-0 break-all font-mono text-high">
                        {file.path}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
