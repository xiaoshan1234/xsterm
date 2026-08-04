import { useState, useEffect } from "react";
import { Box, Button, TextField, Typography } from "@mui/material";
import { SessionGroup } from "../../types/session";
import { Dialog } from "../ui/Dialog";

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

  useEffect(() => { if (isOpen) { setName(group.name); setError(""); } }, [isOpen, group.name]);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) { setError("Group name is required"); return; }
    const duplicate = groups.some((g) => g.id !== group.id && g.name.toLowerCase() === trimmed.toLowerCase());
    if (duplicate) { setError("A group with this name already exists"); return; }
    onSave(group.id, trimmed);
    onClose();
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Edit Group" size="small"
      footer={
        <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="contained" onClick={handleSave}>Save</Button>
        </Box>
      }>
      {error && <Typography color="error" sx={{ mb: 2 }}>{error}</Typography>}
      <TextField fullWidth label="Name" value={name} autoFocus
        onChange={(e) => { setName(e.target.value); setError(""); }}
        onKeyDown={(e) => e.key === "Enter" && handleSave()} />
    </Dialog>
  );
}
