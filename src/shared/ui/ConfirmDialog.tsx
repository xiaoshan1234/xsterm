import { Dialog } from "./Dialog";
import "./ConfirmDialog.css";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDanger?: boolean;
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = "Confirm",
  onConfirm,
  onCancel,
  isDanger = false,
}: ConfirmDialogProps) {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onCancel}
      title={title}
      size="small"
      footer={
        <div className="confirm-dialog-footer">
          <button type="button" className="btn btn--secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={isDanger ? "btn confirm-dialog-danger" : "btn btn--primary"}
            onClick={onConfirm}
            autoFocus={!isDanger}
          >
            {confirmLabel}
          </button>
        </div>
      }
    >
      <p className="confirm-dialog-copy">{message}</p>
    </Dialog>
  );
}
