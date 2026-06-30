import { useState, useEffect, FormEvent } from "react";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";

interface SaveWorkspaceDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
  defaultName: string;
}

export function SaveWorkspaceDialog({ isOpen, onClose, onSave, defaultName }: SaveWorkspaceDialogProps) {
  const [name, setName] = useState(() => defaultName);

  useEffect(() => {
    if (isOpen) {
      setName(defaultName);
    }
  }, [isOpen, defaultName]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed);
    onClose();
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Save Workspace"
      size="small"
      footer={
        <div className="dialog-footer-buttons">
          <button className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={handleSubmit}>
            Save
          </button>
        </div>
      }
    >
      <form onSubmit={handleSubmit}>
        <FormField label="Workspace Name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Work Terminal"
            autoFocus
          />
        </FormField>
      </form>
    </Dialog>
  );
}
