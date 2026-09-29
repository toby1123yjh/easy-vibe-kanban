import { useEffect, useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { IntegrationSettings as IntegrationRecord } from 'shared/types';
import { Button } from '@vibe/ui/components/Button';
import { Input } from '@vibe/ui/components/Input';
import { Switch } from '@vibe/ui/components/Switch';
import { integrationApi } from '@/shared/lib/integrationApi';
import { useSettingsMachineClient } from '@/shared/dialogs/settings/settings/SettingsHostContext';
import { useSettingsMachineState } from '@/shared/dialogs/settings/settings/SettingsMachineUserSystemProvider';
import { useSettingsDirty } from '@/shared/dialogs/settings/settings/SettingsDirtyContext';
import { SettingsCard } from '@/shared/dialogs/settings/settings/SettingsComponents';

interface Draft {
  id?: string;
  name: string;
  enabled: boolean;
  project_ids: string[];
  expected_project_ids: string[];
}

export function IntegrationSettings() {
  const client = useSettingsMachineClient();
  const machine = useSettingsMachineState();
  return (
    <IntegrationSettingsEditor
      key={client?.target.id ?? 'unavailable'}
      hostId={client?.target.apiHostId ?? null}
      enabled={!!client && machine.canMutate}
    />
  );
}

export function IntegrationSettingsEditor({
  hostId,
  enabled,
}: {
  hostId: string | null;
  enabled: boolean;
}) {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  const { setDirty } = useSettingsDirty();
  const fieldId = useId();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [changed, setChanged] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const epoch = useRef(0);
  const owner = useRef({ hostId, enabled, mounted: true });
  if (owner.current.hostId !== hostId) {
    epoch.current += 1;
  }
  Object.assign(owner.current, { hostId, enabled });
  useEffect(() => {
    const lifecycle = owner.current;
    lifecycle.mounted = true;
    return () => {
      lifecycle.mounted = false;
      epoch.current += 1;
    };
  }, []);
  useEffect(() => {
    setDirty('integrations', changed || secret !== null);
    return () => setDirty('integrations', false);
  }, [changed, secret, setDirty]);
  const list = useQuery({
    queryKey: ['integrations', hostId],
    queryFn: () => integrationApi.list(hostId),
    enabled,
  });
  const projects = useQuery({
    queryKey: ['integration-projects', hostId],
    queryFn: () => integrationApi.projects(hostId),
    enabled,
  });
  const blocked = !enabled || pending || list.isPending || list.isError;
  const editable = !blocked && !projects.isPending && !projects.isError;
  const current = (token: number) =>
    owner.current.mounted && epoch.current === token;
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['integrations', hostId] });

  const run = async (operation: (token: number) => Promise<void>) => {
    if (lock.current || !owner.current.enabled || blocked) return;
    lock.current = true;
    setPending(true);
    setError(null);
    const token = epoch.current;
    try {
      await operation(token);
    } catch (cause) {
      if (current(token)) {
        setError(
          cause instanceof Error
            ? cause.message
            : t('externalIntegrations.failed')
        );
      }
    } finally {
      lock.current = false;
      if (owner.current.mounted) setPending(false);
    }
  };

  const edit = (record?: IntegrationRecord) => {
    if (!editable || draft || secret) return;
    setDraft(
      record
        ? {
            ...record,
            project_ids: [...record.project_ids],
            expected_project_ids: [...record.project_ids],
          }
        : {
            name: '',
            enabled: true,
            project_ids: [],
            expected_project_ids: [],
          }
    );
    setChanged(false);
    setError(null);
  };
  const save = () =>
    run(async (token) => {
      if (!draft || !editable || !draft.name.trim()) return;
      const input = { name: draft.name.trim(), project_ids: draft.project_ids };
      if (draft.id) {
        try {
          await integrationApi.update(hostId, draft.id, {
            ...input,
            enabled: draft.enabled,
            expected_project_ids: draft.expected_project_ids,
          });
        } catch (cause) {
          // Retain the draft, but refresh discovery so cancel/reopen can recover
          // from a grant added by the external caller while this form was open.
          void refresh();
          throw cause;
        }
      } else {
        const result = await integrationApi.create(hostId, input);
        if (current(token)) {
          setSecret(result.api_key);
          setCopied(false);
        }
      }
      void refresh();
      if (current(token)) {
        setDraft(null);
        setChanged(false);
      }
    });
  const toggle = (record: IntegrationRecord) =>
    run(async () => {
      await integrationApi.setEnabled(hostId, record.id, !record.enabled);
      void refresh();
    });
  const copy = async () => {
    if (!secret) return;
    const token = epoch.current;
    try {
      await navigator.clipboard.writeText(secret);
      if (current(token)) setCopied(true);
    } catch {
      if (current(token)) setError(t('externalIntegrations.copyFailed'));
    }
  };

  return (
    <SettingsCard
      title={t('externalIntegrations.title')}
      description={t('externalIntegrations.description')}
    >
      <div className="space-y-4">
        <p className="text-base text-low">
          {t('externalIntegrations.endpoint')} <code>/api/integrations/v1</code>
        </p>
        {error && (
          <p role="alert" className="text-base text-error">
            {error}
          </p>
        )}
        {list.isPending && (
          <p role="status">{t('externalIntegrations.loading')}</p>
        )}
        {(list.isError || projects.isError) && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 text-error"
          >
            <span>{t('externalIntegrations.loadFailed')}</span>
            <Button
              variant="outline"
              disabled={!enabled}
              loading={list.isFetching || projects.isFetching}
              onClick={() => {
                void list.refetch();
                void projects.refetch();
              }}
            >
              {t('externalIntegrations.retry')}
            </Button>
          </div>
        )}
        {secret && (
          <div className="space-y-3 rounded border border-brand/40 bg-secondary p-base">
            <label
              htmlFor={`${fieldId}-key`}
              className="block font-medium text-high"
            >
              {t('externalIntegrations.keyOnce')}
            </label>
            <Input
              id={`${fieldId}-key`}
              value={secret}
              readOnly
              autoComplete="off"
              className="font-mono"
              onFocus={(event) => event.target.select()}
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void copy()}>
                {copied
                  ? t('externalIntegrations.copied')
                  : t('externalIntegrations.copy')}
              </Button>
              <Button onClick={() => setSecret(null)}>
                {t('externalIntegrations.keySaved')}
              </Button>
            </div>
          </div>
        )}
        {!draft && !secret && (
          <Button onClick={() => edit()} disabled={!editable}>
            {t('externalIntegrations.create')}
          </Button>
        )}
        {draft && (
          <form
            className="space-y-4 rounded border border-border p-base"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="space-y-2">
              <label htmlFor={`${fieldId}-name`} className="block text-high">
                {t('externalIntegrations.name')}
              </label>
              <Input
                id={`${fieldId}-name`}
                value={draft.name}
                required
                autoFocus
                maxLength={120}
                disabled={!editable}
                onChange={(event) => {
                  setDraft({ ...draft, name: event.target.value });
                  setChanged(true);
                }}
              />
            </div>
            <fieldset disabled={!editable} className="space-y-2">
              <legend className="mb-2 font-medium text-high">
                {t('externalIntegrations.projects')}
              </legend>
              <p className="text-base text-low">
                {t('externalIntegrations.projectHint')}
              </p>
              <div className="max-h-64 overflow-y-auto rounded border border-border">
                {(projects.data ?? []).map((project) => (
                  <label
                    key={project.id}
                    className="flex min-h-10 cursor-pointer items-center gap-3 px-base py-2 hover:bg-secondary"
                  >
                    <input
                      type="checkbox"
                      className="accent-brand"
                      checked={draft.project_ids.includes(project.id)}
                      onChange={(event) => {
                        setDraft({
                          ...draft,
                          project_ids: event.target.checked
                            ? [...draft.project_ids, project.id]
                            : draft.project_ids.filter(
                                (id) => id !== project.id
                              ),
                        });
                        setChanged(true);
                      }}
                    />
                    <span className="min-w-0 break-words text-normal">
                      {project.name}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex gap-2">
              <Button
                type="submit"
                loading={pending}
                disabled={!editable || !draft.name.trim()}
              >
                {draft.id
                  ? t('externalIntegrations.save')
                  : t('externalIntegrations.generate')}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setDraft(null);
                  setChanged(false);
                  setError(null);
                }}
              >
                {t('externalIntegrations.cancel')}
              </Button>
            </div>
          </form>
        )}
        <div className="divide-y divide-border">
          {(list.data ?? []).map((record) => (
            <div
              key={record.id}
              className="flex flex-wrap items-center gap-3 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="break-words font-medium text-high">
                  {record.name}
                </p>
                <p className="text-base text-low">
                  {t('externalIntegrations.projectCount', {
                    count: record.project_ids.length,
                  })}
                </p>
              </div>
              <Button
                variant="outline"
                disabled={!editable || !!draft || !!secret}
                onClick={() => edit(record)}
              >
                {t('externalIntegrations.edit')}
              </Button>
              <label
                className="flex min-h-10 items-center gap-2 text-base"
                htmlFor={`${fieldId}-${record.id}`}
              >
                <span>
                  {record.enabled
                    ? t('externalIntegrations.enabled')
                    : t('externalIntegrations.disabled')}
                </span>
                <Switch
                  id={`${fieldId}-${record.id}`}
                  checked={record.enabled}
                  aria-label={t('externalIntegrations.toggle', {
                    name: record.name,
                  })}
                  disabled={blocked || !!draft || !!secret}
                  onCheckedChange={() => void toggle(record)}
                />
              </label>
            </div>
          ))}
        </div>
        <p className="text-base text-low">
          {t('externalIntegrations.stopHint')}
        </p>
      </div>
    </SettingsCard>
  );
}
