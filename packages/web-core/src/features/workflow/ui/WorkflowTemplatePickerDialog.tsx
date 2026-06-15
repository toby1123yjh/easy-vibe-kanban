import { create, useModal } from '@ebay/nice-modal-react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@vibe/ui/components/KeyboardDialog';
import { defineModal } from '@/shared/lib/modals';

export interface WorkflowTemplatePickerOption {
  id: string;
  name: string;
  description?: string | null;
}

export interface WorkflowTemplatePickerDialogProps {
  templates: WorkflowTemplatePickerOption[];
}

export type WorkflowTemplatePickerResult =
  | { kind: 'selected'; templateId: string | null }
  | { kind: 'canceled' };

const optionButtonClassName =
  'flex flex-col gap-quarter rounded-sm border border-secondary bg-primary px-base py-base text-left ' +
  'transition-colors hover:border-brand hover:bg-brand/5 focus:outline-none focus:ring-1 focus:ring-brand';

function WorkflowTemplatePickerDialogContent({
  templates,
}: WorkflowTemplatePickerDialogProps) {
  const modal = useModal();
  const { t } = useTranslation('common');

  const select = (templateId: string | null) => {
    modal.resolve({
      kind: 'selected',
      templateId,
    } satisfies WorkflowTemplatePickerResult);
    modal.hide();
  };

  const cancel = () => {
    modal.resolve({ kind: 'canceled' } satisfies WorkflowTemplatePickerResult);
    modal.hide();
  };

  return (
    <Dialog
      open={modal.visible}
      onOpenChange={(open) => {
        if (!open) cancel();
      }}
      style={{ maxWidth: 'min(560px, calc(100vw - 32px))' }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('attempts.templatePicker.title', 'Choose a workflow template')}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-half">
          {templates.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => select(template.id)}
              className={optionButtonClassName}
            >
              <span className="text-sm font-medium text-high">
                {template.name}
              </span>
              {template.description ? (
                <span className="text-xs text-low">{template.description}</span>
              ) : null}
            </button>
          ))}

          <button
            type="button"
            onClick={() => select(null)}
            className={optionButtonClassName}
          >
            <span className="text-sm font-medium text-high">
              {t('attempts.templatePicker.blank', 'Blank workflow')}
            </span>
            <span className="text-xs text-low">
              {t(
                'attempts.templatePicker.blankDescription',
                'Start from an empty canvas.'
              )}
            </span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const WorkflowTemplatePickerDialogImpl =
  create<WorkflowTemplatePickerDialogProps>((props) => (
    <WorkflowTemplatePickerDialogContent {...props} />
  ));

export const WorkflowTemplatePickerDialog = defineModal<
  WorkflowTemplatePickerDialogProps,
  WorkflowTemplatePickerResult
>(WorkflowTemplatePickerDialogImpl);
