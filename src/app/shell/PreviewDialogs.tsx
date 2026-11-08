import { useEffect, useRef } from "react";
import { Dialog } from "../../shared/ui/Dialog";
import { FormField } from "../../shared/ui/FormField";
import { type PreviewDialogId } from "./types";

interface PreviewDialogsProps {
  activeDialog: PreviewDialogId | null;
  onClose: () => void;
}

export function PreviewDialogs({ activeDialog, onClose }: PreviewDialogsProps) {
  if (activeDialog === "error") {
    return <BlockingErrorPreview onClose={onClose} />;
  }

  if (activeDialog === "create-terminal" || activeDialog === "edit-terminal") {
    return (
      <Dialog
        isOpen
        onClose={onClose}
        title={activeDialog === "create-terminal" ? "Create Terminal" : "Edit Terminal"}
        footer={
          <DialogFooter
            primaryLabel={activeDialog === "create-terminal" ? "Create" : "Save"}
            onClose={onClose}
          />
        }
      >
        <TerminalDialogPreview />
      </Dialog>
    );
  }

  if (activeDialog === "create-tmux" || activeDialog === "edit-tmux") {
    return (
      <Dialog
        isOpen
        onClose={onClose}
        title={activeDialog === "create-tmux" ? "Create Tmux Session" : "Edit Tmux Session"}
        footer={
          <DialogFooter
            primaryLabel={activeDialog === "create-tmux" ? "Create" : "Save"}
            onClose={onClose}
          />
        }
      >
        <TmuxDialogPreview />
      </Dialog>
    );
  }

  if (activeDialog === "rename") {
    return (
      <Dialog
        isOpen
        onClose={onClose}
        title="Rename"
        size="small"
        footer={<DialogFooter primaryLabel="Rename" onClose={onClose} />}
      >
        <FormField label="Name">
          <input type="text" defaultValue="Main workspace" autoFocus />
        </FormField>
      </Dialog>
    );
  }

  if (activeDialog === "confirm") {
    return (
      <Dialog
        isOpen
        onClose={onClose}
        title="Delete saved workspace?"
        size="small"
        footer={<DialogFooter primaryLabel="Delete" isDanger onClose={onClose} />}
      >
        <p className="shell-dialog-copy">
          The saved workspace snapshot will be removed. Running terminals are not closed.
        </p>
      </Dialog>
    );
  }

  return null;
}

function TerminalDialogPreview() {
  return (
    <div className="shell-form-preview">
      <div className="shell-segmented-control" role="group" aria-label="Terminal type">
        <button type="button" className="shell-segment shell-segment--active">
          Shell
        </button>
        <button type="button" className="shell-segment">
          SSH
        </button>
      </div>
      <FormField label="Name">
        <input type="text" defaultValue="Local PowerShell" />
      </FormField>
      <FormField label="Shell">
        <select defaultValue="powershell">
          <option value="powershell">PowerShell</option>
          <option value="cmd">Command Prompt</option>
          <option value="git-bash">Git Bash</option>
        </select>
      </FormField>
      <FormField label="Working directory">
        <input type="text" defaultValue="C:\\Users\\developer" />
      </FormField>
    </div>
  );
}

function TmuxDialogPreview() {
  return (
    <div className="shell-form-preview">
      <FormField label="Base configuration">
        <select defaultValue="production">
          <option value="production">Production SSH</option>
          <option value="local">Local PowerShell</option>
        </select>
      </FormField>
      <FormField label="Tmux session">
        <input type="text" defaultValue="dev" />
      </FormField>
      <FormField label="Socket name">
        <input type="text" defaultValue="work" />
      </FormField>
      <FormField label="Start command">
        <input type="text" placeholder="Optional command" />
      </FormField>
    </div>
  );
}

function DialogFooter({
  primaryLabel,
  onClose,
  isDanger = false,
}: {
  primaryLabel: string;
  onClose: () => void;
  isDanger?: boolean;
}) {
  return (
    <div className="shell-dialog-footer">
      <button type="button" className="btn btn--secondary" onClick={onClose}>
        Cancel
      </button>
      <button
        type="button"
        className={isDanger ? "btn shell-danger-button" : "btn btn--primary"}
        onClick={onClose}
      >
        {primaryLabel}
      </button>
    </div>
  );
}

function BlockingErrorPreview({ onClose }: { onClose: () => void }) {
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
          <h2 id="shell-error-title">Unable to create SSH terminal</h2>
          <p id="shell-error-description">
            The remote host did not accept the connection. Check the SSH settings and try again.
          </p>
          <details>
            <summary>Show details</summary>
            <code>Connection timed out after 20s · host=example.com · port=22</code>
          </details>
        </div>
        <div className="shell-error-actions">
          <button type="button" className="btn btn--secondary">
            Copy details
          </button>
          <button ref={acknowledgeRef} type="button" className="btn btn--primary" onClick={onClose}>
            Acknowledge
          </button>
        </div>
      </div>
    </div>
  );
}
