import { useEffect, useState } from "react";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";

interface NewGroupDialogProps {
  isOpen: boolean;
  onClose: () => void;
  existingGroupNames: string[];
  onCreate: (name: string) => void;
}

/**
 * Small modal for creating a new session group. Owns its own name + error
 * state; resets them every time it opens.
 */
export function NewGroupDialog({
  isOpen,
  onClose,
  existingGroupNames,
  onCreate,
}: NewGroupDialogProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  // Reset form whenever the dialog opens (covers the "open → submit → reopen" flow).
  useEffect(() => {
    if (isOpen) {
      setName("");
      setError("");
    }
  }, [isOpen]);

  const handleCreate = () => {
    setError("");
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Group name is required");
      return;
    }
    if (existingGroupNames.some((n) => n.toLowerCase() === trimmed.toLowerCase())) {
      setError("A group with this name already exists");
      return;
    }
    onCreate(trimmed);
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Create Group"
      size="small"
      footer={
        <div className="dialog-footer-buttons">
          <button className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" onClick={handleCreate}>
            Create
          </button>
        </div>
      }
    >
      {error && <div className="dialog-error">{error}</div>}
      <FormField label="Group Name">
        <input
          type="text"
          placeholder="e.g., Work, Personal"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError("");
          }}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          autoFocus
        />
      </FormField>
    </Dialog>
  );
}
