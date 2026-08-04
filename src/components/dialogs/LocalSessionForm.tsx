import { useEffect, useState } from "react";
import { Box, Button, MenuItem, Select, TextField, IconButton, FormControl, InputLabel, Stack } from "@mui/material";
import { Delete as DeleteIcon, Add as AddIcon } from "@mui/icons-material";
import { LocalSessionConfig } from "../../types/session";

const isWindows = navigator.userAgent.toLowerCase().includes("windows") || navigator.platform.toLowerCase().includes("win");

const LOCAL_SHELLS = isWindows
  ? [
      { value: "", label: "Default (PowerShell)" },
      { value: "powershell.exe", label: "PowerShell" },
      { value: "pwsh.exe", label: "PowerShell 7" },
      { value: "cmd.exe", label: "CMD" },
      { value: "wsl.exe", label: "WSL (Default Distro)" },
      { value: "wsl.exe -d Ubuntu", label: "WSL - Ubuntu" },
      { value: "wsl.exe -d Debian", label: "WSL - Debian" },
      { value: "wsl.exe -d Arch", label: "WSL - Arch" },
    ]
  : [
      { value: "", label: "Default ($SHELL)" },
      { value: "/bin/bash", label: "Bash" },
      { value: "/bin/zsh", label: "Zsh" },
      { value: "/bin/sh", label: "Sh" },
    ];

const CWD_PLACEHOLDER = isWindows ? "C:\\Users\\you or %USERPROFILE%" : "/home/user or ~";

interface LocalSessionFormProps {
  config: LocalSessionConfig;
  onChange: (config: LocalSessionConfig) => void;
  mode?: "create" | "edit";
}

interface EnvVar { key: string; value: string; }

function envVarsToMap(vars: EnvVar[]): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  for (const v of vars) if (v.key.trim()) result[v.key.trim()] = v.value;
  return Object.keys(result).length > 0 ? result : undefined;
}

export function LocalSessionForm({ config, onChange, mode = "create" }: LocalSessionFormProps) {
  const [envVars, setEnvVars] = useState<EnvVar[]>(() => {
    const env = config.envConfig?.env || {};
    return Object.entries(env).map(([key, value]) => ({ key, value }));
  });

  useEffect(() => {
    if (mode === "create") { onChange({}); setEnvVars([]); }
  }, [mode]);

  const updateEnvVars = (next: EnvVar[]) => {
    setEnvVars(next);
    const envMap = envVarsToMap(next);
    onChange({ ...config, envConfig: envMap ? { env: envMap } : undefined });
  };

  return (
    <Stack spacing={2}>
      <FormControl fullWidth>
        <InputLabel id="shell-select-label">Shell</InputLabel>
        <Select
          labelId="shell-select-label"
          label="Shell"
          value={config.shell || ""}
          onChange={(e) => onChange({ ...config, shell: e.target.value || undefined })}
        >
          {LOCAL_SHELLS.map((s) => <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>)}
        </Select>
      </FormControl>

      <TextField
        fullWidth
        label="Initial Directory"
        placeholder={CWD_PLACEHOLDER}
        value={config.cwd || ""}
        onChange={(e) => onChange({ ...config, cwd: e.target.value })}
      />

      <TextField
        fullWidth
        label="Arguments"
        placeholder="--cd /home/user (space separated)"
        value={config.args?.join(" ") || ""}
        onChange={(e) => {
          const value = e.target.value;
          const args = value.trim() ? value.split(/\s+/) : undefined;
          onChange({ ...config, args });
        }}
      />

      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>Environment Variables</Typography>
        <Stack spacing={1}>
          {envVars.map((env, index) => (
            <Box key={index} sx={{ display: "flex", gap: 1, alignItems: "center" }}>
              <TextField size="small" placeholder="KEY" value={env.key} sx={{ flex: 1 }}
                onChange={(e) => {
                  const next = [...envVars];
                  next[index] = { ...env, key: e.target.value };
                  updateEnvVars(next);
                }} />
              <TextField size="small" placeholder="VALUE" value={env.value} sx={{ flex: 1 }}
                onChange={(e) => {
                  const next = [...envVars];
                  next[index] = { ...env, value: e.target.value };
                  updateEnvVars(next);
                }} />
              <IconButton size="small" onClick={() => updateEnvVars(envVars.filter((_, i) => i !== index))}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          ))}
          <Button startIcon={<AddIcon />} size="small" onClick={() => updateEnvVars([...envVars, { key: "", value: "" }])}>
            Add Variable
          </Button>
        </Stack>
      </Box>
    </Stack>
  );
}
