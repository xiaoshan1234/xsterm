import { useState, useEffect } from "react";
import { Box, MenuItem, Select, TextField, FormControlLabel, Switch, Stack, FormControl, InputLabel } from "@mui/material";
import { SSHSessionConfig } from "../../types/session";

const DEFAULT_SSH_CONFIG: SSHSessionConfig = {
  host: "", port: 22, username: "", auth_type: "password", password: "", key_file: "", passphrase: "",
};

const TERM_TYPES = [
  { value: "xterm-256color", label: "xterm-256color (recommended)" },
  { value: "xterm", label: "xterm" },
  { value: "vt100", label: "vt100" },
  { value: "screen", label: "screen" },
];

interface SshSessionFormProps {
  config: SSHSessionConfig;
  onChange: (config: SSHSessionConfig) => void;
  onError: (error: string) => void;
  mode?: "create" | "edit";
}

export function SshSessionForm({ config, onChange, mode = "create" }: SshSessionFormProps) {
  useEffect(() => { if (mode === "create") onChange(DEFAULT_SSH_CONFIG); }, [mode]);

  const update = (patch: Partial<SSHSessionConfig>) => onChange({ ...config, ...patch });

  return (
    <Stack spacing={2}>
      <TextField fullWidth label="Host" placeholder="example.com" value={config.host} onChange={(e) => update({ host: e.target.value })} />
      <TextField fullWidth type="number" label="Port" placeholder="22" value={config.port} onChange={(e) => update({ port: parseInt(e.target.value) || 22 })} />
      <TextField fullWidth label="Username" placeholder="root" value={config.username} onChange={(e) => update({ username: e.target.value })} />

      <FormControl fullWidth>
        <InputLabel id="auth-select-label">Authentication</InputLabel>
        <Select
          labelId="auth-select-label"
          label="Authentication"
          value={config.auth_type}
          onChange={(e) => update({ auth_type: e.target.value as "password" | "key" })}
        >
          <MenuItem value="password">Password</MenuItem>
          <MenuItem value="key">Key File</MenuItem>
        </Select>
      </FormControl>

      {config.auth_type === "password" ? (
        <TextField fullWidth type="password" label="Password" placeholder="********" value={config.password || ""} onChange={(e) => update({ password: e.target.value })} />
      ) : (
        <Stack spacing={2}>
          <TextField fullWidth label="Key File Path" placeholder="~/.ssh/id_rsa" value={config.key_file || ""} onChange={(e) => update({ key_file: e.target.value })} />
          <TextField fullWidth type="password" label="Passphrase (optional)" placeholder="********" value={config.passphrase || ""} onChange={(e) => update({ passphrase: e.target.value })} />
        </Stack>
      )}

      <FormControl fullWidth>
        <InputLabel id="term-select-label">Terminal Type</InputLabel>
        <Select
          labelId="term-select-label"
          label="Terminal Type"
          value={config.termType || "xterm-256color"}
          onChange={(e) => update({ termType: e.target.value })}
        >
          {TERM_TYPES.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
        </Select>
      </FormControl>

      <TextField fullWidth type="number" label="Initial Rows" placeholder="24" value={config.initialRows ?? ""} onChange={(e) => { const v = e.target.value; update({ initialRows: v ? parseInt(v) : undefined }); }} />
      <TextField fullWidth type="number" label="Initial Cols" placeholder="80" value={config.initialCols ?? ""} onChange={(e) => { const v = e.target.value; update({ initialCols: v ? parseInt(v) : undefined }); }} />
      <TextField fullWidth type="number" label="Keepalive Interval (seconds)" placeholder="(disabled)" value={config.keepaliveInterval ?? ""} onChange={(e) => { const v = e.target.value; update({ keepaliveInterval: v ? parseInt(v) : undefined }); }} />
      <TextField fullWidth type="number" label="Connection Timeout (seconds)" placeholder="(no timeout)" value={config.connectionTimeout ?? ""} onChange={(e) => { const v = e.target.value; update({ connectionTimeout: v ? parseInt(v) : undefined }); }} />

      <FormControlLabel
        control={<Switch checked={config.enableCompression ?? false} onChange={(e) => update({ enableCompression: e.target.checked })} />}
        label="Enable Compression"
      />
    </Stack>
  );
}

export function validateSshConfig(config: SSHSessionConfig): string | null {
  if (!config.host || !config.username) return "Host and username are required";
  if (config.auth_type === "password" && !config.password) return "Password is required";
  if (config.auth_type === "key" && !config.key_file) return "Key file path is required";
  return null;
}

export function useSshFormReset(isOpen: boolean) {
  const [config, setConfig] = useState<SSHSessionConfig>(DEFAULT_SSH_CONFIG);
  useEffect(() => { if (isOpen) setConfig(DEFAULT_SSH_CONFIG); }, [isOpen]);
  return [config, setConfig] as const;
}
