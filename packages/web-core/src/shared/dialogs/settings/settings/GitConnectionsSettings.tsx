import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { GitConnection, WriteGitConnection } from 'shared/types';
import { Button } from '@vibe/ui/components/Button';
import { Input } from '@vibe/ui/components/Input';
import { ConfirmDialog } from '@vibe/ui/components/ConfirmDialog';
import { gitImportApi } from '@/shared/lib/gitImportApi';
import { useSettingsMachineClient } from './SettingsHostContext';
import { useSettingsMachineState } from './SettingsMachineUserSystemProvider';
import { useSettingsDirty } from './SettingsDirtyContext';
import { SettingsCard } from './SettingsComponents';

const emptyDraft = (): WriteGitConnection => ({
  name: '',
  host: 'github.com',
  port: 22,
  username: 'git',
  auth_mode: 'native',
  private_key: null,
  password: null,
});
const selectClass =
  'min-h-9 rounded border border-border bg-primary px-2 text-sm text-normal focus-visible:ring-2 focus-visible:ring-brand';

export function GitConnectionsSettings() {
  const client = useSettingsMachineClient();
  const machine = useSettingsMachineState();
  return (
    <GitConnectionsEditor
      key={client?.target.id ?? 'unavailable'}
      hostId={client?.target.apiHostId ?? null}
      enabled={!!client && machine.canMutate}
    />
  );
}

export function GitConnectionsEditor({
  hostId,
  enabled,
}: {
  hostId: string | null;
  enabled: boolean;
}) {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  const { setDirty } = useSettingsDirty();
  const [draft, setDraft] = useState<WriteGitConnection | null>(null);
  const [editing, setEditing] = useState<GitConnection | null>(null);
  const [changed, setChanged] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [testId, setTestId] = useState<string | null>(null);
  const [testUrl, setTestUrl] = useState('');
  const lock = useRef(false);
  const generation = useRef(0);
  const draftRevision = useRef(0);
  const [readingKey, setReadingKey] = useState(false);
  const readingKeyRef = useRef(false);
  const owner = useRef({ hostId, enabled, mounted: true });
  if (owner.current.hostId !== hostId) generation.current += 1;
  Object.assign(owner.current, { hostId, enabled });
  useEffect(() => {
    const current = owner.current;
    current.mounted = true;
    return () => {
      current.mounted = false;
      generation.current += 1;
    };
  }, []);
  useEffect(() => {
    setDirty('git-connections', changed);
    return () => setDirty('git-connections', false);
  }, [changed, setDirty]);
  const list = useQuery({
    queryKey: ['git-connections', hostId],
    queryFn: () => gitImportApi.connections(hostId),
    enabled,
  });
  const blocked =
    !enabled || pending || readingKey || list.isError || list.isPending;
  const current = (epoch: number) =>
    owner.current.mounted &&
    owner.current.enabled &&
    generation.current === epoch;
  const edit = (value: GitConnection | null) => {
    draftRevision.current += 1;
    setEditing(value);
    setDraft(
      value
        ? {
            name: value.name,
            host: value.host,
            port: value.port,
            username: value.username,
            auth_mode: value.auth_mode,
            private_key: null,
            password: null,
          }
        : emptyDraft()
    );
    setChanged(false);
    setShowSecret(false);
    setError(null);
    setNotice(null);
  };
  const patch = (value: Partial<WriteGitConnection>) => {
    draftRevision.current += 1;
    setDraft((before) => (before ? { ...before, ...value } : before));
    setChanged(true);
    setError(null);
  };
  const run = async (operation: (epoch: number) => Promise<void>) => {
    if (lock.current || readingKeyRef.current || !owner.current.enabled) return;
    lock.current = true;
    setPending(true);
    setError(null);
    setNotice(null);
    const epoch = generation.current;
    try {
      await operation(epoch);
    } catch (cause) {
      if (current(epoch))
        setError(
          cause instanceof Error
            ? cause.message
            : t('gitConnections.failed', 'Operation failed. Try again.')
        );
    } finally {
      lock.current = false;
      if (owner.current.mounted && generation.current === epoch)
        setPending(false);
    }
  };
  const save = () =>
    run(async (epoch) => {
      if (!draft) return;
      const modeChanged = !editing || editing.auth_mode !== draft.auth_mode;
      if (
        !draft.name.trim() ||
        !draft.host.trim() ||
        !draft.username.trim() ||
        !Number.isInteger(draft.port) ||
        draft.port < 1 ||
        draft.port > 65535 ||
        (modeChanged && draft.auth_mode === 'private_key' && !draft.private_key)
      ) {
        throw new Error(
          t(
            'gitConnections.required',
            'Complete the connection fields and required credentials.'
          )
        );
      }
      await gitImportApi.saveConnection(
        hostId,
        {
          ...draft,
          name: draft.name.trim(),
          host: draft.host.trim(),
          username: draft.username.trim(),
        },
        editing?.id
      );
      void queryClient.invalidateQueries({
        queryKey: ['git-connections', hostId],
      });
      if (!current(epoch)) return;
      draftRevision.current += 1;
      setDraft(null);
      setEditing(null);
      setChanged(false);
      setShowSecret(false);
      setNotice(t('gitConnections.saved', 'Connection saved.'));
    });
  const remove = (connection: GitConnection) =>
    run(async (epoch) => {
      const result = await ConfirmDialog.show({
        title: t('gitConnections.delete', 'Delete connection'),
        message: t('gitConnections.deleteHint', {
          name: connection.name,
          defaultValue:
            'Delete “{{name}}” and its saved credentials? Existing repositories are kept.',
        }),
        variant: 'destructive',
      });
      if (result !== 'confirmed' || !current(epoch)) return;
      await gitImportApi.deleteConnection(hostId, connection.id);
      void queryClient.invalidateQueries({
        queryKey: ['git-connections', hostId],
      });
      if (current(epoch)) {
        setNotice(t('gitConnections.deleted', 'Connection deleted.'));
        if (testId === connection.id) setTestId(null);
      }
    });
  const test = () =>
    run(async (epoch) => {
      if (!testId || !testUrl.trim()) return;
      await gitImportApi.testConnection(hostId, testId, testUrl.trim());
      if (current(epoch))
        setNotice(
          t(
            'gitConnections.tested',
            'Connection works; repository is readable.'
          )
        );
    });
  const importKey = async (file: File | undefined) => {
    if (!file || blocked || readingKeyRef.current) return;
    const epoch = generation.current;
    const revision = draftRevision.current;
    readingKeyRef.current = true;
    setReadingKey(true);
    try {
      if (file.size > 1024 * 1024)
        throw new Error(
          t(
            'gitConnections.keyTooLarge',
            'Choose a private key smaller than 1 MB.'
          )
        );
      const contents = await file.text();
      if (current(epoch) && draftRevision.current === revision)
        patch({ private_key: contents });
    } catch {
      if (current(epoch) && draftRevision.current === revision)
        setError(
          t(
            'gitConnections.importFailed',
            'Private key could not be imported. Check the file and try again.'
          )
        );
    } finally {
      readingKeyRef.current = false;
      if (owner.current.mounted && generation.current === epoch)
        setReadingKey(false);
    }
  };
  return (
    <SettingsCard
      title={t('gitConnections.title', 'Git connections')}
      description={t(
        'gitConnections.description',
        'Connections and encrypted credentials are stored on the selected machine. Native Git / SSH remains available without a saved connection.'
      )}
    >
      {list.isPending && enabled && (
        <p role="status">
          {t('gitConnections.loading', 'Loading connections…')}
        </p>
      )}
      {list.isError && (
        <p role="alert">
          {t('gitConnections.loadFailed', 'Connections could not be loaded.')}{' '}
          <Button
            variant="outline"
            disabled={pending || !enabled}
            onClick={() => void list.refetch()}
          >
            {t('common:buttons.retry', 'Retry')}
          </Button>
        </p>
      )}
      {!enabled && (
        <p role="status">
          {t(
            'gitConnections.unavailable',
            'Connect this machine before editing Git connections.'
          )}
        </p>
      )}
      {list.data?.length === 0 && (
        <p className="text-sm text-low">
          {t('gitConnections.empty', 'No saved connections.')}
        </p>
      )}
      <ul className="space-y-2">
        {(list.data ?? []).map((connection) => (
          <li
            key={connection.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded border border-border p-3"
          >
            <div className="min-w-0 text-sm">
              <p>{connection.name}</p>
              <p className="break-all text-xs text-low">
                {connection.username}@{connection.host}:{connection.port}
              </p>
              {!connection.credential_ready && (
                <p className="text-xs text-error">
                  {connection.credential_error ??
                    t(
                      'gitConnections.credentialUnavailable',
                      'Credential unavailable. Import the private key again.'
                    )}
                </p>
              )}
              {connection.fingerprint && (
                <p className="break-all text-xs text-low">
                  {connection.fingerprint}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                disabled={blocked || !!draft}
                onClick={() => edit(connection)}
              >
                {t('gitConnections.edit', 'Edit')}
              </Button>
              <Button
                variant="ghost"
                disabled={blocked || !!draft}
                onClick={() => {
                  setTestId(connection.id);
                  setTestUrl('');
                  setNotice(null);
                }}
              >
                {t('gitConnections.test', 'Test')}
              </Button>
              <Button
                variant="ghost"
                disabled={blocked || !!draft}
                onClick={() => void remove(connection)}
              >
                {t('gitConnections.delete', 'Delete connection')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {!draft && (
        <Button
          type="button"
          variant="outline"
          disabled={blocked}
          onClick={() => edit(null)}
        >
          {t('gitConnections.add', 'Add connection')}
        </Button>
      )}
      {testId && !draft && (
        <div className="space-y-2">
          <label className="block text-sm">
            {t('gitConnections.testUrl', 'Repository URL to test')}
            <Input
              value={testUrl}
              disabled={blocked}
              onChange={(e) => setTestUrl(e.target.value)}
            />
          </label>
          <Button
            type="button"
            disabled={blocked || !testUrl.trim()}
            onClick={() => void test()}
          >
            {pending
              ? t('gitConnections.testing', 'Testing…')
              : t('gitConnections.test', 'Test')}
          </Button>
        </div>
      )}
      {draft && (
        <div className="space-y-3 rounded border border-border p-3">
          <label className="block text-sm">
            {t('gitConnections.provider', 'Provider')}
            <select
              className={`${selectClass} block w-full`}
              disabled={blocked}
              value={
                draft.host === 'github.com'
                  ? 'github'
                  : draft.host === 'gitlab.com'
                    ? 'gitlab'
                    : 'custom'
              }
              onChange={(e) =>
                patch({
                  host:
                    e.target.value === 'github'
                      ? 'github.com'
                      : e.target.value === 'gitlab'
                        ? 'gitlab.com'
                        : '',
                })
              }
            >
              <option value="github">GitHub</option>
              <option value="gitlab">GitLab</option>
              <option value="custom">
                {t('gitConnections.custom', 'Custom')}
              </option>
            </select>
          </label>
          <label className="block text-sm">
            {t('gitConnections.name', 'Connection name')}
            <Input
              disabled={blocked}
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="block text-sm">
              {t('gitConnections.host', 'Git host')}
              <Input
                disabled={blocked}
                value={draft.host}
                onChange={(e) => patch({ host: e.target.value })}
              />
            </label>
            <label className="block text-sm">
              {t('gitConnections.port', 'SSH port')}
              <Input
                type="number"
                min={1}
                max={65535}
                disabled={blocked}
                value={draft.port}
                onChange={(e) => patch({ port: Number(e.target.value) })}
              />
            </label>
          </div>
          <label className="block text-sm">
            {t('gitConnections.username', 'SSH user')}
            <Input
              disabled={blocked}
              value={draft.username}
              onChange={(e) => patch({ username: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            {t('gitConnections.auth', 'Authentication')}
            <select
              className={`${selectClass} block w-full`}
              value={draft.auth_mode}
              disabled={blocked}
              onChange={(e) => {
                const auth_mode = e.target.value;
                if (auth_mode === 'native' || auth_mode === 'private_key')
                  patch({ auth_mode, private_key: null, password: null });
              }}
            >
              <option value="native">
                {t('gitConnections.native', 'Machine Git / SSH')}
              </option>
              <option value="private_key">
                {t('gitConnections.privateKey', 'Private key')}
              </option>
            </select>
          </label>
          {draft.auth_mode !== 'native' && (
            <>
              <p className="text-xs text-low">
                {t(
                  'gitConnections.keepSecret',
                  'When editing, untouched credentials keep the saved values. Clear the passphrase explicitly to remove it. Changing authentication requires new credentials.'
                )}
              </p>
              {draft.auth_mode === 'private_key' && (
                <>
                  <label className="block text-sm">
                    {t('gitConnections.privateKey', 'Private key')}
                    <textarea
                      aria-label={t('gitConnections.privateKey', 'Private key')}
                      className={`${selectClass} block min-h-24 w-full font-mono ${showSecret ? '' : '[-webkit-text-security:disc]'}`}
                      autoComplete="off"
                      spellCheck={false}
                      disabled={blocked}
                      value={draft.private_key ?? ''}
                      onChange={(e) =>
                        patch({ private_key: e.target.value || null })
                      }
                    />
                  </label>
                  <label className="block text-sm">
                    {t('gitConnections.importKey', 'Import private key file')}
                    <input
                      className="block w-full text-sm"
                      type="file"
                      disabled={blocked}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        void importKey(file);
                      }}
                    />
                  </label>
                </>
              )}
              <label className="block text-sm">
                {t('gitConnections.passphrase', 'Key passphrase (optional)')}
                <Input
                  type={showSecret ? 'text' : 'password'}
                  autoComplete="new-password"
                  disabled={blocked}
                  value={draft.password ?? ''}
                  onChange={(e) => patch({ password: e.target.value })}
                />
              </label>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowSecret((value) => !value)}
              >
                {showSecret
                  ? t('gitConnections.hide', 'Hide credentials')
                  : t('gitConnections.show', 'Show credentials')}
              </Button>
            </>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={blocked}
              onClick={() => void save()}
            >
              {pending
                ? t('gitConnections.saving', 'Saving…')
                : t('common:buttons.save', 'Save')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                draftRevision.current += 1;
                setDraft(null);
                setChanged(false);
                setEditing(null);
                setShowSecret(false);
              }}
            >
              {t('common:buttons.cancel', 'Cancel')}
            </Button>
          </div>
        </div>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
    </SettingsCard>
  );
}
