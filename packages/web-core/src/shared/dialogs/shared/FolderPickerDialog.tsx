import { useCallback, useEffect, useRef, useState } from 'react';
import { create, useModal } from '@ebay/nice-modal-react';
import {
  ArrowUp,
  Check,
  Folder,
  FolderOpen,
  GitBranch,
  Loader2,
  Monitor,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DirectoryEntry, DirectoryListResponse } from 'shared/types';
import { Button } from '@vibe/ui/components/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@vibe/ui/components/KeyboardDialog';
import { fileSystemApi } from '@/shared/lib/api';
import { cn } from '@/shared/lib/utils';
import { defineModal } from '@/shared/lib/modals';

export interface FolderPickerDialogProps {
  value?: string;
  title?: string;
  description?: string;
  hostId?: string | null;
}

const parentDirectory = (path: string): string | null => {
  const trimmed = path.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/[\\/]$/, '');
  const separator = Math.max(
    normalized.lastIndexOf('\\'),
    normalized.lastIndexOf('/')
  );
  if (separator < 0) return null;
  if (separator === 2 && normalized[1] === ':') return normalized.slice(0, 3);
  if (separator === 0) return normalized.slice(0, 1);
  return normalized.slice(0, separator);
};

const FolderPickerDialogImpl = create<FolderPickerDialogProps>(
  ({ value = '', title, description, hostId }) => {
    const modal = useModal();
    const { t } = useTranslation('common');
    const requestId = useRef(0);
    const [directory, setDirectory] = useState<DirectoryListResponse | null>(
      null
    );
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedPath, setSelectedPath] = useState(value.trim());

    const loadDirectory = useCallback(
      async (path?: string) => {
        const id = ++requestId.current;
        setLoading(true);
        setError(null);
        try {
          const result = await fileSystemApi.list(path || undefined, hostId);
          if (id !== requestId.current) return;
          setDirectory(result);
          setSelectedPath(result.current_path);
        } catch (nextError) {
          if (id !== requestId.current) return;
          setError(
            nextError instanceof Error
              ? nextError.message
              : t('folderPicker.errors.load', {
                  defaultValue: 'Unable to read this directory.',
                })
          );
        } finally {
          if (id === requestId.current) setLoading(false);
        }
      },
      [hostId, t]
    );

    useEffect(() => {
      if (!modal.visible) return;
      setDirectory(null);
      setSelectedPath(value.trim());
      void loadDirectory(value.trim() || undefined);
    }, [loadDirectory, modal.visible, value]);

    const handleCancel = () => {
      requestId.current += 1;
      modal.resolve(null);
      modal.hide();
    };

    const handleSystemPicker = async () => {
      const id = ++requestId.current;
      setLoading(true);
      setError(null);
      try {
        const result = await fileSystemApi.pickFolder(
          {
            initial_path: directory?.current_path ?? (value.trim() || null),
            title: title?.trim() || null,
          },
          hostId
        );
        if (id !== requestId.current || !result) return;
        modal.resolve(result);
        modal.hide();
      } catch (nextError) {
        if (id !== requestId.current) return;
        setError(
          nextError instanceof Error
            ? nextError.message
            : t('folderPicker.errors.system', {
                defaultValue: 'Unable to open the system folder picker.',
              })
        );
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    };

    const entries =
      directory?.entries.filter((entry) => entry.is_directory) ?? [];
    const currentPath = directory?.current_path ?? selectedPath;
    const parent = parentDirectory(currentPath);

    return (
      <Dialog
        open={modal.visible}
        onOpenChange={(open) => {
          if (!open) handleCancel();
        }}
      >
        <DialogContent
          role="dialog"
          aria-modal="true"
          aria-labelledby="folder-picker-title"
          className="max-h-[calc(100dvh-2rem)] overflow-hidden"
          style={{ maxWidth: 'min(640px, calc(100vw - 32px))' }}
        >
          <DialogHeader>
            <DialogTitle id="folder-picker-title">
              {title ??
                t('folderPicker.title', { defaultValue: 'Choose a directory' })}
            </DialogTitle>
            <DialogDescription>
              {description ??
                t('folderPicker.description', {
                  defaultValue: 'Select a directory to use in this workspace.',
                })}
            </DialogDescription>
          </DialogHeader>

          <div className="flex min-h-0 flex-col gap-base">
            <div className="flex items-center gap-half rounded-sm border border-border bg-secondary/30 px-base py-half">
              <FolderOpen
                className="size-icon-xs shrink-0 text-low"
                aria-hidden="true"
              />
              <span
                className="min-w-0 flex-1 truncate text-sm text-normal"
                title={currentPath}
              >
                {currentPath ||
                  t('folderPicker.home', { defaultValue: 'Home directory' })}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!parent || loading}
                onClick={() => parent && void loadDirectory(parent)}
                aria-label={t('folderPicker.parent', {
                  defaultValue: 'Go to parent directory',
                })}
              >
                <ArrowUp className="size-icon-xs" aria-hidden="true" />
              </Button>
            </div>

            <div
              className="min-h-48 overflow-y-auto rounded-sm border border-border"
              aria-live="polite"
            >
              {loading ? (
                <div className="flex h-48 items-center justify-center gap-half text-sm text-low">
                  <Loader2
                    className="size-icon-sm animate-spin"
                    aria-hidden="true"
                  />
                  {t('folderPicker.loading', {
                    defaultValue: 'Loading directories…',
                  })}
                </div>
              ) : error ? (
                <div className="flex h-48 flex-col items-center justify-center gap-half px-base text-center">
                  <p className="text-sm text-error" role="alert">
                    {error}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void loadDirectory(currentPath)}
                  >
                    {t('buttons.retry', { defaultValue: 'Retry' })}
                  </Button>
                </div>
              ) : entries.length === 0 ? (
                <div className="flex h-48 items-center justify-center px-base text-sm text-low">
                  {t('folderPicker.empty', {
                    defaultValue: 'No subdirectories here.',
                  })}
                </div>
              ) : (
                <div className="p-half">
                  {entries.map((entry: DirectoryEntry) => (
                    <button
                      key={entry.path}
                      type="button"
                      className={cn(
                        'flex min-h-10 w-full items-center gap-half rounded-sm px-base text-left text-sm transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand',
                        selectedPath === entry.path && 'bg-secondary'
                      )}
                      onClick={() => setSelectedPath(entry.path)}
                      onDoubleClick={() => void loadDirectory(entry.path)}
                    >
                      <Folder
                        className="size-icon-sm shrink-0 text-low"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {entry.name}
                      </span>
                      {entry.is_git_repo ? (
                        <GitBranch
                          className="size-icon-xs shrink-0 text-low"
                          aria-label="Git repository"
                        />
                      ) : null}
                      {selectedPath === entry.path ? (
                        <Check
                          className="size-icon-xs text-brand"
                          aria-hidden="true"
                        />
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="flex-wrap justify-between gap-half">
            <Button
              type="button"
              variant="ghost"
              onClick={() => void handleSystemPicker()}
              disabled={loading}
              className="gap-half"
            >
              <Monitor className="size-icon-xs" aria-hidden="true" />
              {t('folderPicker.systemPicker', {
                defaultValue: 'Use system picker',
              })}
            </Button>
            <div className="flex gap-half">
              <Button type="button" variant="ghost" onClick={handleCancel}>
                {t('buttons.cancel')}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  if (!currentPath) return;
                  modal.resolve(currentPath);
                  modal.hide();
                }}
                disabled={loading || !currentPath || Boolean(error)}
                className="gap-half"
              >
                <Check className="size-icon-xs" aria-hidden="true" />
                {t('folderPicker.select', {
                  defaultValue: 'Select this directory',
                })}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
);

export const FolderPickerDialog = defineModal<
  FolderPickerDialogProps,
  string | null
>(FolderPickerDialogImpl);
