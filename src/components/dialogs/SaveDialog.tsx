import { useState, useEffect, FormEvent } from "react";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";
import "./SaveDialog.css";

interface SaveDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
  defaultName: string;
  title?: string;
  label?: string;
  validateName?: (name: string) => string | null;
}

export function SaveDialog({
  isOpen,
  onClose,
  onSave,
  defaultName,
  title = "Save",
  label = "Name",
  validateName,
}: SaveDialogProps) {
  const [name, setName] = useState(() => defaultName);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setName(defaultName);
      setError(null);
    }
  }, [isOpen, defaultName]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    if (validateName) {
      const validationError = validateName(trimmed);
      if (validationError) {
        setError(validationError);
        return;
      }
    }

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
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError(null);
            }}
            placeholder="e.g., Work Terminal"
            autoFocus
          />
          {error && <span className="save-dialog__error">{error}</span>}
        </FormField>
      </form>
    </Dialog>
  );
}
