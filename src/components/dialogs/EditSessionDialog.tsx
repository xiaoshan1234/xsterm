import { useState, useEffect } from "react";
import { Box, Button, FormControl, InputLabel, MenuItem, Select, TextField, Typography } from "@mui/material";
import { SavedSessionConfig, LocalSessionConfig, SSHSessionConfig, SessionGroup, SessionDisplayConfig } from "../../types/session";
import { Dialog } from "../ui/Dialog";
import { LocalSessionForm } from "./LocalSessionForm";
import { SshSessionForm, validateSshConfig } from "./SshSessionForm";
import { DisplayConfigForm } from "./DisplayConfigForm";

interface EditSessionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  config: SavedSessionConfig;
  groups: SessionGroup[];
  groupId: number | null;
  onSave: (config: SavedSessionConfig, groupId: number | null) => void;
}

export function EditSessionDialog({ isOpen, onClose, config, groups, groupId, onSave }: EditSessionDialogProps) {
  const [name, setName] = useState(config.name);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(groupId);
  const [localConfig, setLocalConfig] = useState<LocalSessionConfig>(config.localConfig ?? {});
  const [sshConfig, setSshConfig] = useState<SSHSessionConfig>(
    config.sshConfig ?? { host: "", port: 22, username: "", auth_type: "password", password: "", key_file: "", passphrase: "" }
  );
  const [displayConfig, setDisplayConfig] = useState<SessionDisplayConfig | undefined>(config.displayConfig);
  const [sshError, setSshError] = useState("");

  useEffect(() => {
    if (isOpen) {
      setName(config.name);
      setSelectedGroupId(groupId);
      setLocalConfig(config.localConfig ?? {});
      setSshConfig(config.sshConfig ?? { host: "", port: 22, username: "", auth_type: "password", password: "", key_file: "", passphrase: "" });
      setDisplayConfig(config.displayConfig);
      setSshError("");
    }
  }, [isOpen, config, groupId]);

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    if (config.type === "ssh") {
      const validationError = validateSshConfig(sshConfig);
      if (validationError) { setSshError(validationError); return; }
    }
    const updatedConfig: SavedSessionConfig = {
      ...config,
      name: trimmedName,
      localConfig: config.type === "local" ? localConfig : undefined,
      sshConfig: config.type === "ssh" ? sshConfig : undefined,
      displayConfig,
    };
    onSave(updatedConfig, selectedGroupId);
    onClose();
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Edit Session" size="medium"
      footer={
        <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="contained" onClick={handleSave}>Save</Button>
        </Box>
      }>
      <TextField fullWidth label="Name" value={name} autoFocus sx={{ mb: 2 }}
        onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSave()} />

      <FormControl fullWidth sx={{ mb: 2 }}>
        <InputLabel id="edit-group-select-label">Group</InputLabel>
        <Select labelId="edit-group-select-label" label="Group"
          value={selectedGroupId === null ? "none" : selectedGroupId}
          onChange={(e) => setSelectedGroupId(e.target.value === "none" ? null : Number(e.target.value))}>
          <MenuItem value="none">None</MenuItem>
          {groups.map((g) => <MenuItem key={g.id} value={g.id}>{g.name}</MenuItem>)}
        </Select>
      </FormControl>

      {config.type === "local" && <LocalSessionForm config={localConfig} onChange={setLocalConfig} mode="edit" />}

      {config.type === "ssh" && (
        <>
          {sshError && <Typography color="error" sx={{ mb: 2 }}>{sshError}</Typography>}
          <SshSessionForm config={sshConfig} onChange={(cfg) => { setSshConfig(cfg); setSshError(""); }} onError={setSshError} mode="edit" />
        </>
      )}

      <Box sx={{ mt: 2, p: 1, border: 1, borderColor: "divider", borderRadius: 1 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>Display Options (optional)</Typography>
        <DisplayConfigForm config={displayConfig} onChange={setDisplayConfig} />
      </Box>
    </Dialog>
  );
}
