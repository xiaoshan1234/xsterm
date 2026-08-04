import { useState, useEffect } from "react";
import { Box, Button, Tabs, Tab, MenuItem, Select, FormControl, InputLabel, TextField, Switch, FormControlLabel, Typography } from "@mui/material";
import { useSession } from "../../contexts/SessionContext";
import { LocalSessionConfig, SSHSessionConfig, Session, SessionDisplayConfig } from "../../types/session";
import { Dialog } from "../ui/Dialog";
import { LocalSessionForm } from "./LocalSessionForm";
import { SshSessionForm, validateSshConfig } from "./SshSessionForm";
import { DisplayConfigForm } from "./DisplayConfigForm";

interface CreateSessionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateLocal: (config: LocalSessionConfig, save: boolean, displayConfig?: SessionDisplayConfig) => Promise<Session>;
  onCreateSsh: (config: SSHSessionConfig, save: boolean, displayConfig?: SessionDisplayConfig) => Promise<Session>;
  initialTab?: "local" | "ssh";
  initialGroupId?: number | null;
}

export default function CreateSessionDialog({
  isOpen,
  onClose,
  onCreateLocal,
  onCreateSsh,
  initialTab = "local",
  initialGroupId,
}: CreateSessionDialogProps) {
  const { groups, addToGroup } = useSession();
  const [tab, setTab] = useState<"local" | "ssh">(initialTab);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [saveConfig, setSaveConfig] = useState(true);
  const [localConfig, setLocalConfig] = useState<LocalSessionConfig>({});
  const [sshConfig, setSshConfig] = useState<SSHSessionConfig>({
    host: "", port: 22, username: "", auth_type: "password", password: "", key_file: "", passphrase: "",
  });
  const [displayConfig, setDisplayConfig] = useState<SessionDisplayConfig | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isOpen) {
      setTab(initialTab);
      setSelectedGroupId(initialGroupId ?? null);
      setError("");
      setLocalConfig({});
      setSshConfig({ host: "", port: 22, username: "", auth_type: "password", password: "", key_file: "", passphrase: "" });
      setDisplayConfig(undefined);
    }
  }, [isOpen, initialGroupId, initialTab]);

  const handleCreate = async () => {
    setError("");
    let session: Session;
    try {
      if (tab === "local") {
        session = await onCreateLocal(localConfig, saveConfig, displayConfig);
      } else {
        const validationError = validateSshConfig(sshConfig);
        if (validationError) { setError(validationError); return; }
        session = await onCreateSsh(sshConfig, saveConfig, displayConfig);
      }
      if (selectedGroupId !== null) addToGroup(selectedGroupId, session.configId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const footer = (
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
      <FormControlLabel
        control={<Switch checked={saveConfig} onChange={(e) => setSaveConfig(e.target.checked)} />}
        label="Save config"
      />
      <Box sx={{ display: "flex", gap: 1 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleCreate}>Create</Button>
      </Box>
    </Box>
  );

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title="Create Session" footer={footer}>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}>
        <Tab value="local" label="Local Shell" />
        <Tab value="ssh" label="SSH" />
      </Tabs>

      {error && (
        <Typography color="error" sx={{ mb: 2, p: 1, bgcolor: "error.main", color: "error.contrastText", borderRadius: 1, opacity: 0.9 }}>
          {error}
        </Typography>
      )}

      <FormControl fullWidth sx={{ mb: 2 }}>
        <InputLabel id="group-select-label">Group</InputLabel>
        <Select
          labelId="group-select-label"
          label="Group"
          value={selectedGroupId === null ? "none" : selectedGroupId}
          onChange={(e) => setSelectedGroupId(e.target.value === "none" ? null : Number(e.target.value))}
        >
          <MenuItem value="none">None</MenuItem>
          {groups.map((g) => <MenuItem key={g.id} value={g.id}>{g.name}</MenuItem>)}
        </Select>
      </FormControl>

      {tab === "local" ? (
        <LocalSessionForm config={localConfig} onChange={setLocalConfig} />
      ) : (
        <SshSessionForm config={sshConfig} onChange={setSshConfig} onError={setError} />
      )}

      <Box sx={{ mt: 2, p: 1, border: 1, borderColor: "divider", borderRadius: 1 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>Display Options (optional)</Typography>
        <DisplayConfigForm config={displayConfig} onChange={setDisplayConfig} />
      </Box>
    </Dialog>
  );
}
