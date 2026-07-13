import { fileSystemApi } from '@/shared/lib/api';

export interface FolderPickerDialogProps {
  value?: string;
  title?: string;
  description?: string;
  hostId?: string | null;
}

export const FolderPickerDialog = {
  show: async ({
    value,
    title,
    hostId,
  }: FolderPickerDialogProps): Promise<string | null> =>
    fileSystemApi.pickFolder(
      {
        initial_path: value?.trim() || null,
        title: title?.trim() || null,
      },
      hostId
    ),
};
