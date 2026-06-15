import { useState, useEffect } from "react";
import { SessionGroup } from "../../types/session";
import { Dialog } from "../ui/Dialog";
import { FormField } from "../ui/FormField";

interface EditGroupDialogProps {
  isOpen: boolean;
  onClose: () => void;
  group: SessionGroup;
  groups: SessionGroup[];
  onSave: (id: number, name: string) => void;
}

export function EditGroupDialog({ isOpen, onClose, group, groups, onSave }: EditGroupDialogProps) {
  const [name, setName] = useState(group.name);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isOpen) {
      setName(group.name);
      setError("");
    }
  }, [isOpen, group.name]);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Group name is required");
      return;
    }
    const duplicate = groups.some(
      (g) => g.id !== group.id && g.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (duplicate) {
      setError("A group with this name already exists");
      return;
    }
    onSave(group.id, trimmed);
    onClose();
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Group"
      size="small"
      footer={
        <div className="dialog-footer-buttons">
          <button className="btn btn--secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={handleSave}>Save</button>
        </div>
      }
    >
      {error && <div className="dialog-error">{error}</div>}
      <FormField label="Name">
        <input
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value); setError(""); }}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          autoFocus
        />
      </FormField>
    </Dialog>
  );
}
