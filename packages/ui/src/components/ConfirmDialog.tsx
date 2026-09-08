import { useRef, type ReactNode } from 'react';
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
  SpinnerIcon,
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

export interface ConfirmDialogViewProps extends ConfirmDialogProps {
  open: boolean;
  onConfirm(): void;
  onCancel(): void;
  confirmDisabled?: boolean;
  cancelDisabled?: boolean;
  confirmPending?: boolean;
  confirmVariant?: 'default' | 'destructive';
  /** Disable when the caller restores focus after a guarded async operation. */
  restoreFocus?: boolean;
  children?: ReactNode;
}

/** Controlled confirmation presentation; callers own lookup and mutation state. */
export function ConfirmDialogView(props: ConfirmDialogViewProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const {
    title,
    message,
    confirmText = t('common:confirm.defaultConfirm'),
    cancelText = t('common:confirm.defaultCancel'),
    variant = 'default',
    icon = true,
    showCancelButton = true,
    open,
    onConfirm,
    onCancel,
    confirmDisabled = false,
    cancelDisabled = false,
    confirmPending = false,
    confirmVariant,
    restoreFocus = true,
    children,
  } = props;

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
    return (
      confirmVariant ?? (variant === 'destructive' ? 'destructive' : 'default')
    );
  };

  const confirmButton = (
    <Button
      ref={confirmButtonRef}
      className={`${showCancelButton ? '' : 'ml-auto '}min-h-11 sm:min-h-[var(--vk-button-height)]`}
      variant={getConfirmButtonVariant()}
      disabled={confirmDisabled || confirmPending}
      onClick={onConfirm}
    >
      {confirmPending && (
        <SpinnerIcon
          aria-hidden="true"
          className="mr-2 size-4 animate-spin motion-reduce:animate-none"
        />
      )}
      {confirmText}
    </Button>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open && !cancelDisabled) onCancel();
      }}
    >
      <DialogContent
        hideCloseButton
        role={variant === 'destructive' ? 'alertdialog' : 'dialog'}
        data-variant={variant}
        className="bg-[var(--vk-dialog-surface)] text-[var(--vk-text-normal)] sm:max-w-[425px]"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const activeElement = document.activeElement;
          returnFocusRef.current =
            activeElement instanceof HTMLElement &&
            activeElement !== document.body &&
            activeElement !== document.documentElement
              ? activeElement
              : null;
          const target = showCancelButton
            ? cancelButtonRef.current
            : confirmButtonRef.current;
          target?.focus();
        }}
        onCloseAutoFocus={(event) => {
          // Imperative confirmations have no Radix DialogTrigger to restore.
          event.preventDefault();
          if (restoreFocus && returnFocusRef.current?.isConnected) {
            returnFocusRef.current.focus({ preventScroll: true });
          }
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
        {children}
        {showCancelButton ? (
          <DialogFooter className="gap-2">
            <Button
              ref={cancelButtonRef}
              className="min-h-11 sm:min-h-[var(--vk-button-height)]"
              variant="outline"
              disabled={cancelDisabled}
              onClick={onCancel}
            >
              {cancelText}
            </Button>
            {confirmButton}
          </DialogFooter>
        ) : (
          <div className="flex w-full">{confirmButton}</div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const ConfirmDialogImpl = NiceModal.create<ConfirmDialogProps>((props) => {
  const modal = useModal();

  const close = (result: ConfirmResult) => {
    modal.resolve(result);
    void modal.hide();
  };

  return (
    <ConfirmDialogView
      {...props}
      open={modal.visible}
      onConfirm={() => close('confirmed')}
      onCancel={() => close('canceled')}
    />
  );
});

export const ConfirmDialog = defineModal<ConfirmDialogProps, ConfirmResult>(
  ConfirmDialogImpl
);
