import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialogView } from './ConfirmDialog';
import { defineModal } from '../lib/modals';

export interface ErrorDialogProps {
  title: string;
  message: string;
  buttonText?: string;
}

const ErrorDialogImpl = NiceModal.create<ErrorDialogProps>((props) => {
  const { t } = useTranslation('common');
  const modal = useModal();
  const { title, message, buttonText = t('ok') } = props;

  const handleDismiss = () => {
    modal.resolve();
    void modal.hide();
  };

  return (
    <ConfirmDialogView
      open={modal.visible}
      title={title}
      message={message}
      variant="destructive"
      confirmVariant="default"
      confirmText={buttonText}
      showCancelButton={false}
      onConfirm={handleDismiss}
      onCancel={handleDismiss}
    />
  );
});

export const ErrorDialog = defineModal<ErrorDialogProps, void>(ErrorDialogImpl);
