import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './Dialog';
import { Button } from './Button';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import {
  WarningIcon,
  InfoIcon,
  CheckCircleIcon,
  XCircleIcon,
} from '@phosphor-icons/react';
import { defineModal, type ConfirmResult } from '../lib/modals';

export interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'default' | 'destructive' | 'info' | 'success';
  icon?: boolean;
  showCancelButton?: boolean;
}

const ConfirmDialogImpl = NiceModal.create<ConfirmDialogProps>((props) => {
  const { t } = useTranslation(['tasks', 'common']);
  const modal = useModal();
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const {
    title,
    message,
    confirmText = t('common:confirm.defaultConfirm'),
    cancelText = t('common:confirm.defaultCancel'),
    variant = 'default',
    icon = true,
    showCancelButton = true,
  } = props;

  const handleConfirm = () => {
    modal.resolve('confirmed' as ConfirmResult);
    modal.hide();
  };

  const handleCancel = () => {
    modal.resolve('canceled' as ConfirmResult);
    modal.hide();
  };

  const getIcon = () => {
    if (!icon) return null;

    const iconClass = 'h-6 w-6';

    switch (variant) {
      case 'destructive':
        return (
          <WarningIcon
            aria-hidden="true"
            className={`${iconClass} text-[var(--vk-status-error)]`}
          />
        );
      case 'info':
        return (
          <InfoIcon
            aria-hidden="true"
            className={`${iconClass} text-[var(--vk-status-running-text)]`}
          />
        );
      case 'success':
        return (
          <CheckCircleIcon
            aria-hidden="true"
            className={`${iconClass} text-[var(--vk-status-success-text)]`}
          />
        );
      default:
        return (
          <XCircleIcon
            aria-hidden="true"
            className={`${iconClass} text-[var(--vk-text-low)]`}
          />
        );
    }
  };

  const getConfirmButtonVariant = () => {
    return variant === 'destructive' ? 'destructive' : 'default';
  };

  return (
    <Dialog
      open={modal.visible}
      onOpenChange={(open) => {
        if (!open) handleCancel();
      }}
    >
      <DialogContent
        hideCloseButton
        role={variant === 'destructive' ? 'alertdialog' : 'dialog'}
        data-variant={variant}
        className="bg-[var(--vk-dialog-surface)] text-[var(--vk-text-normal)] sm:max-w-[425px]"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const target = showCancelButton
            ? cancelButtonRef.current
            : confirmButtonRef.current;
          target?.focus();
        }}
      >
        <DialogHeader>
          <div className="flex items-center gap-3">
            {getIcon()}
            <DialogTitle>{title}</DialogTitle>
          </div>
          <DialogDescription className="text-left pt-2">
            {message}
          </DialogDescription>
        </DialogHeader>
        {showCancelButton ? (
          <DialogFooter className="gap-2">
            <Button
              ref={cancelButtonRef}
              className="min-h-11 sm:min-h-[var(--vk-button-height)]"
              variant="outline"
              onClick={handleCancel}
            >
              {cancelText}
            </Button>
            <Button
              ref={confirmButtonRef}
              className="min-h-11 sm:min-h-[var(--vk-button-height)]"
              variant={getConfirmButtonVariant()}
              onClick={handleConfirm}
            >
              {confirmText}
            </Button>
          </DialogFooter>
        ) : (
          <div className="flex w-full">
            <Button
              ref={confirmButtonRef}
              className="ml-auto min-h-11 sm:min-h-[var(--vk-button-height)]"
              variant={getConfirmButtonVariant()}
              onClick={handleConfirm}
            >
              {confirmText}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
});

export const ConfirmDialog = defineModal<ConfirmDialogProps, ConfirmResult>(
  ConfirmDialogImpl
);
