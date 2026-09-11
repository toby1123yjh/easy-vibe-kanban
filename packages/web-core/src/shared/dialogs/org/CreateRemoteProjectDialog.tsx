import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { GitProjectImportPanel } from '@/shared/components/GitProjectImportPanel';
import { clearGitImportRecovery } from '@/shared/lib/gitImportRecovery';
import { useQueryClient } from '@tanstack/react-query';
import { useHostId } from '@/shared/providers/HostIdProvider';
import { Button } from '@vibe/ui/components/Button';
import { Input } from '@vibe/ui/components/Input';
import { Label } from '@vibe/ui/components/Label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@vibe/ui/components/KeyboardDialog';
import { Alert, AlertDescription } from '@vibe/ui/components/Alert';
import { create, useModal } from '@ebay/nice-modal-react';
import { useTranslation } from 'react-i18next';
import { defineModal } from '@/shared/lib/modals';
import { useShape } from '@/shared/integrations/electric/hooks';
import {
  PROJECTS_SHAPE,
  PROJECT_MUTATION,
  type Project,
} from 'shared/remote-types';
import { getRandomPresetColor, PRESET_COLORS } from '@/shared/lib/colors';
import { ColorPicker } from '@/shared/components/ui-new/containers/ColorPickerContainer';
import {
  SettingsHostProvider,
  useSettingsHost,
} from '@/shared/dialogs/settings/settings/SettingsHostContext';
import {
  WorkspaceTargetDialog,
  type WorkspaceTargetSelection,
} from '@/shared/dialogs/shared/WorkspaceTargetDialog';
import {
  projectWorkspaceDefaultQueryKey,
  saveProjectWorkspaceDefault,
} from '@/shared/hooks/useProjectRepoDefaults';
import {
  workspaceSelectionDefault,
  canUseProjectCreationHost,
} from './projectCreationWorkspace';

export type CreateRemoteProjectDialogProps = {
  organizationId: string;
  initialHostId?: string;
};

export type CreateRemoteProjectResult = {
  action: 'created' | 'canceled';
  project?: Project;
};

function CreateRemoteProjectForm({
  organizationId,
  initialHostId,
}: CreateRemoteProjectDialogProps) {
  const modal = useModal();
  const { t } = useTranslation('projects');
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(() => getRandomPresetColor());
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isChoosing, setIsChoosing] = useState(false);
  const [source, setSource] = useState<'local' | 'git'>('local');
  const [importBusy, setImportBusy] = useState(false);
  const [createdProject, setCreatedProject] = useState<Project | null>(null);
  const [location, setLocation] = useState<{
    hostId: string;
    selection: WorkspaceTargetSelection;
  } | null>(null);
  const busyRef = useRef(false);
  const importedJobId = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const routeHostId = useHostId();
  const { selectedHost, selectedHostId, availableHosts, setSelectedHostId } =
    useSettingsHost();
  const hostRef = useRef(selectedHost);
  hostRef.current = selectedHost;
  const visibleRef = useRef(modal.visible);
  visibleRef.current = modal.visible;
  const scopeRef = useRef({
    organizationId,
    visible: modal.visible,
    epoch: 0,
    mounted: true,
  });
  if (
    scopeRef.current.organizationId !== organizationId ||
    scopeRef.current.visible !== modal.visible
  ) {
    scopeRef.current = {
      organizationId,
      visible: modal.visible,
      epoch: scopeRef.current.epoch + 1,
      mounted: true,
    };
  }
  useEffect(() => {
    scopeRef.current.mounted = true;
    return () => {
      scopeRef.current.mounted = false;
      scopeRef.current.epoch += 1;
    };
  }, []);
  const ownsScope = (epoch: number) =>
    scopeRef.current.mounted &&
    scopeRef.current.visible &&
    scopeRef.current.epoch === epoch;
  const canChoose = canUseProjectCreationHost(selectedHost);
  const busy = isCreating || isChoosing || importBusy;
  const onImported = useCallback(
    (selection: WorkspaceTargetSelection, jobId: string) => {
      const host = hostRef.current;
      if (host && visibleRef.current && canUseProjectCreationHost(host)) {
        importedJobId.current = jobId;
        setLocation({ hostId: host.id, selection });
      }
    },
    []
  );

  const params = useMemo(
    () => ({ organization_id: organizationId }),
    [organizationId]
  );

  const { insert, error: syncError } = useShape(PROJECTS_SHAPE, params, {
    mutation: PROJECT_MUTATION,
  });

  useEffect(() => {
    // Reset form when dialog opens
    if (modal.visible) {
      setName('');
      setColor(getRandomPresetColor());
      setError(null);
      setIsCreating(false);
      setCreatedProject(null);
      setLocation(null);
      setIsChoosing(false);
      setSource('local');
      setImportBusy(false);
      busyRef.current = false;
    }
  }, [modal.visible]);

  useEffect(() => {
    if (syncError) {
      setError(syncError.message || 'Failed to create project');
    }
  }, [syncError]);

  const finish = (project: Project) => {
    if (source === 'git' && selectedHost && importedJobId.current) {
      try {
        clearGitImportRecovery(
          selectedHost.apiHostId,
          organizationId,
          importedJobId.current
        );
      } catch {
        /* A storage failure must not hide a successfully saved project. */
      }
    }
    modal.resolve({ action: 'created', project } as CreateRemoteProjectResult);
    modal.hide();
  };

  const chooseLocation = async () => {
    const epoch = scopeRef.current.epoch;
    const host = hostRef.current;
    if (busyRef.current || !host || !canUseProjectCreationHost(host)) return;
    busyRef.current = true;
    setIsChoosing(true);
    setError(null);
    try {
      const previous = location?.hostId === host.id ? location.selection : null;
      const result = await WorkspaceTargetDialog.show({
        purpose: 'project_default',
        title: t('createProjectDialog.chooseWorkspace', 'Choose directory'),
        description: t(
          'createProjectDialog.workspaceHint',
          'Set the default location for future tasks. This does not create a workspace or start an agent.'
        ),
        hostId: host.apiHostId,
        initialPath: previous?.path,
        initialBranch:
          previous?.mode === 'worktree' ? previous.targetBranch : null,
      });
      if (!ownsScope(epoch) || result.kind !== 'confirmed') return;
      if (!canUseProjectCreationHost(hostRef.current, host.id)) {
        setError(
          t(
            'createProjectDialog.hostChanged',
            'The machine changed or became unavailable. Please choose the working directory again.'
          )
        );
        return;
      }
      setLocation({ hostId: host.id, selection: result.selection });
    } catch (err) {
      if (!ownsScope(epoch)) return;
      setError(
        err instanceof Error
          ? err.message
          : t(
              'createProjectDialog.machineUnavailable',
              'Connect a machine to choose a working directory, or set it up later.'
            )
      );
    } finally {
      if (ownsScope(epoch)) {
        busyRef.current = false;
        setIsChoosing(false);
      }
    }
  };

  const validateName = (value: string): string | null => {
    const trimmedValue = value.trim();
    if (!trimmedValue) return 'Project name is required';
    if (trimmedValue.length < 2)
      return 'Project name must be at least 2 characters';
    if (trimmedValue.length > 100)
      return 'Project name must be 100 characters or less';
    return null;
  };

  const handleCreate = async () => {
    const epoch = scopeRef.current.epoch;
    if (busyRef.current || importBusy || (source === 'git' && !location))
      return;
    const nameError = validateName(name);
    if (nameError) {
      setError(nameError);
      return;
    }

    setError(null);
    setIsCreating(true);
    busyRef.current = true;
    let savedProject = createdProject;

    try {
      if (
        location &&
        !canUseProjectCreationHost(hostRef.current, location.hostId)
      ) {
        throw new Error(
          t(
            'createProjectDialog.hostChanged',
            'The machine changed or became unavailable. Please choose the working directory again.'
          )
        );
      }
      if (!savedProject) {
        const { data: project, persisted } = insert({
          organization_id: organizationId,
          name: name.trim(),
          color: color,
        });

        savedProject = (await persisted) ?? project;
        if (!ownsScope(epoch)) return;
        setCreatedProject(savedProject);
      }
      if (location) {
        const host = hostRef.current;
        if (!host || !canUseProjectCreationHost(host, location.hostId)) {
          throw new Error(
            t(
              'createProjectDialog.hostChanged',
              'The machine changed or became unavailable. Please choose the working directory again.'
            )
          );
        }
        await saveProjectWorkspaceDefault(
          savedProject.id,
          workspaceSelectionDefault(location.selection),
          host.apiHostId
        );
        void queryClient.invalidateQueries({
          queryKey: projectWorkspaceDefaultQueryKey(
            savedProject.id,
            host.apiHostId
          ),
        });
      }
      if (ownsScope(epoch)) finish(savedProject);
    } catch (err) {
      if (!ownsScope(epoch)) return;
      setError(
        savedProject
          ? t(
              'createProjectDialog.workspaceSaveFailed',
              'The project was created, but its working directory could not be saved. Retry or finish and set it up later.'
            )
          : err instanceof Error
            ? err.message
            : 'Failed to create project'
      );
    } finally {
      if (ownsScope(epoch)) {
        setIsCreating(false);
        busyRef.current = false;
      }
    }
  };

  const handleCancel = () => {
    if (busyRef.current || importBusy) return;
    if (createdProject) {
      finish(createdProject);
      return;
    }
    modal.resolve({ action: 'canceled' } as CreateRemoteProjectResult);
    modal.hide();
  };

  const handleOpenChange = (open: boolean) => {
    if (busyRef.current || importBusy) return;

    if (!open) {
      handleCancel();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (
      e.key === 'Enter' &&
      !e.nativeEvent.isComposing &&
      name.trim() &&
      !busy
    ) {
      e.preventDefault();
      void handleCreate();
    }
  };

  return (
    <Dialog open={modal.visible} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-md max-h-[90dvh] overflow-y-auto"
        role="dialog"
        aria-labelledby="create-project-title"
        aria-describedby="create-project-description"
      >
        <DialogHeader>
          <DialogTitle id="create-project-title">
            {t('createProjectDialog.title', 'Create Project')}
          </DialogTitle>
          <DialogDescription id="create-project-description">
            {t(
              'createProjectDialog.description',
              'Create a new project in this organization.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="project-name">
              {t('createProjectDialog.nameLabel', 'Project name')}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="project-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
                onKeyDown={handleKeyDown}
                placeholder={t(
                  'createProjectDialog.namePlaceholder',
                  'Enter project name'
                )}
                maxLength={100}
                autoFocus
                disabled={busy || !!createdProject}
                className="flex-1"
              />
              <ColorPicker
                value={color}
                onChange={setColor}
                colors={PRESET_COLORS}
                disabled={busy || !!createdProject}
                align="start"
                side="bottom"
              >
                <button
                  type="button"
                  className="w-10 h-10 rounded border cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ backgroundColor: `hsl(${color})` }}
                  disabled={busy || !!createdProject}
                  aria-label={t(
                    'createProjectDialog.selectColor',
                    'Select project color'
                  )}
                />
              </ColorPicker>
            </div>
          </div>

          <section
            className="space-y-3 border-t border-border pt-4"
            aria-labelledby="project-workspace-label"
          >
            <fieldset className="flex flex-wrap gap-4 text-sm">
              <legend className="mb-2 font-medium">
                {t('gitImport.source', 'Project source')}
              </legend>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="project-source"
                  checked={source === 'local'}
                  disabled={busy || !!createdProject}
                  onChange={() => {
                    setSource('local');
                    setLocation(null);
                  }}
                />
                {t('gitImport.local', 'Local directory')}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="project-source"
                  checked={source === 'git'}
                  disabled={busy || !!createdProject}
                  onChange={() => {
                    setSource('git');
                    setLocation(null);
                  }}
                />
                {t('gitImport.remote', 'Git repository')}
              </label>
            </fieldset>
            <div>
              <h3 id="project-workspace-label" className="text-sm font-medium">
                {source === 'git'
                  ? t('gitImport.remote', 'Git repository')
                  : t(
                      'createProjectDialog.workspaceLabel',
                      'Working directory (optional)'
                    )}
              </h3>
              {source === 'local' && (
                <p className="mt-1 text-xs text-low">
                  {t(
                    'createProjectDialog.workspaceHint',
                    'Set the default location for future tasks. This does not create a workspace or start an agent.'
                  )}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="project-machine">
                {t('createProjectDialog.machineLabel', 'Machine')}
              </Label>
              <select
                id="project-machine"
                className="h-9 w-full rounded border border-border bg-primary px-2 text-sm text-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                value={selectedHostId ?? ''}
                disabled={busy || !!initialHostId || !!routeHostId}
                onChange={(e) => {
                  setSelectedHostId(e.target.value);
                  setLocation(null);
                  setError(null);
                }}
              >
                {!selectedHost && (
                  <option value={selectedHostId ?? ''}>
                    {t(
                      'createProjectDialog.machineUnavailable',
                      'Machine unavailable'
                    )}
                  </option>
                )}
                {availableHosts.map((host) => (
                  <option
                    key={host.id}
                    value={host.id}
                    disabled={host.status === 'offline'}
                  >
                    {host.label}
                    {host.status === 'offline'
                      ? ` (${t('common:offline', 'Offline')})`
                      : ''}
                  </option>
                ))}
              </select>
            </div>
            {source === 'git' && selectedHost && (
              <GitProjectImportPanel
                key={`${selectedHost.id}:${organizationId}`}
                hostId={selectedHost.apiHostId}
                recoveryScope={organizationId}
                enabled={canChoose && !isCreating && !createdProject}
                onReady={onImported}
                onBusyChange={setImportBusy}
              />
            )}
            {source === 'local' &&
              (location ? (
                <div
                  className="break-all rounded border border-border bg-secondary p-2 text-xs"
                  role="status"
                >
                  <div>{location.selection.path}</div>
                  {location.selection.mode === 'worktree' && (
                    <div className="mt-1 text-low">
                      {location.selection.targetBranch}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-low">
                  {t(
                    'createProjectDialog.workspaceEmpty',
                    'Choose a local folder or Git repository. You can also set this up later.'
                  )}
                </p>
              ))}
            {!canChoose && (
              <p className="text-xs text-low" role="status">
                {t(
                  'createProjectDialog.machineUnavailable',
                  'Connect a machine to choose a working directory, or set it up later.'
                )}
              </p>
            )}
            {source === 'local' && (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  type="button"
                  disabled={busy || !canChoose}
                  onClick={() => void chooseLocation()}
                >
                  {location
                    ? t(
                        'createProjectDialog.changeWorkspace',
                        'Change directory'
                      )
                    : t(
                        'createProjectDialog.chooseWorkspace',
                        'Choose directory'
                      )}
                </Button>
                {location && (
                  <Button
                    variant="ghost"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setLocation(null);
                      setError(null);
                    }}
                  >
                    {t('createProjectDialog.later', 'Set up later')}
                  </Button>
                )}
              </div>
            )}
          </section>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={busy}>
            {createdProject
              ? t('createProjectDialog.finishLater', 'Finish; set up later')
              : t('common:buttons.cancel', 'Cancel')}
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!name.trim() || busy || (source === 'git' && !location)}
          >
            {isCreating
              ? createdProject
                ? t(
                    'createProjectDialog.savingWorkspace',
                    'Saving directory...'
                  )
                : t('createProjectDialog.creating', 'Creating...')
              : createdProject
                ? location
                  ? t('createProjectDialog.retrySave', 'Save directory')
                  : t('createProjectDialog.finishLater', 'Finish; set up later')
                : t('createProjectDialog.createButton', 'Create Project')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const CreateRemoteProjectDialogImpl = create<CreateRemoteProjectDialogProps>(
  (props) => (
    <SettingsHostProvider initialHostId={props.initialHostId}>
      <CreateRemoteProjectForm {...props} />
    </SettingsHostProvider>
  )
);

export const CreateRemoteProjectDialog = defineModal<
  CreateRemoteProjectDialogProps,
  CreateRemoteProjectResult
>(CreateRemoteProjectDialogImpl);
