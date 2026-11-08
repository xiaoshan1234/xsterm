import { useEffect, useRef } from "react";

export interface ErrorDialogData {
  title: string;
  message: string;
  details?: string;
}

interface ErrorDialogProps {
  error: ErrorDialogData;
  onAcknowledge: () => void;
}

export function ErrorDialog({ error, onAcknowledge }: ErrorDialogProps) {
  const acknowledgeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    acknowledgeRef.current?.focus();
  }, []);

  return (
    <div className="shell-error-overlay" role="presentation">
      <div
        className="shell-error-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="shell-error-title"
        aria-describedby="shell-error-description"
      >
        <div className="shell-error-mark" aria-hidden="true">
          !
        </div>
        <div className="shell-error-copy">
          <div className="shell-eyebrow shell-eyebrow--error">Operation failed</div>
          <h2 id="shell-error-title">{error.title}</h2>
          <p id="shell-error-description">{error.message}</p>
          {error.details && (
            <details>
              <summary>Show details</summary>
              <code>{error.details}</code>
            </details>
          )}
        </div>
        <div className="shell-error-actions">
          <button
            ref={acknowledgeRef}
            type="button"
            className="btn btn--primary"
            onClick={onAcknowledge}
          >
            Acknowledge
          </button>
        </div>
      </div>
    </div>
  );
}
