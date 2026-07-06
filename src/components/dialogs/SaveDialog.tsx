import { useState, useEffect, FormEvent } from "react";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";

interface SaveDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
  defaultName: string;
  title?: string;
  label?: string;
}

export function SaveDialog({
  isOpen,
  onClose,
  onSave,
  defaultName,
  title = "Save",
  label = "Name",
}: SaveDialogProps) {
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
      title={title}
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
        <FormField label={label}>
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
