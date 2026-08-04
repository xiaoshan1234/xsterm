import { useState, useEffect, FormEvent } from "react";
import { Box, Button, TextField, Typography } from "@mui/material";
import { Dialog } from "../ui/Dialog";

interface SaveDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
  defaultName: string;
  title?: string;
  label?: string;
  validateName?: (name: string) => string | null;
}

export function SaveDialog({ isOpen, onClose, onSave, defaultName, title = "Save", label = "Name", validateName }: SaveDialogProps) {
  const [name, setName] = useState(() => defaultName);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (isOpen) { setName(defaultName); setError(null); } }, [isOpen, defaultName]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (validateName) {
      const validationError = validateName(trimmed);
      if (validationError) { setError(validationError); return; }
    }
    onSave(trimmed);
    onClose();
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={title} size="small"
      footer={
        <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmit}>Save</Button>
        </Box>
      }>
      <form onSubmit={handleSubmit}>
        <TextField fullWidth label={label} value={name} autoFocus placeholder="e.g., Work Terminal"
          onChange={(e) => { setName(e.target.value); if (error) setError(null); }} />
        {error && <Typography color="error" sx={{ mt: 1, fontSize: "0.8125rem" }}>{error}</Typography>}
      </form>
    </Dialog>
  );
}
