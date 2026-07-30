import { useEffect, useState } from "react";
import { LocalSessionConfig } from "../../types/session";
import { FormField } from "../ui/FormField";
import "./LocalSessionForm.css";

const isWindows = navigator.userAgent.toLowerCase().includes("windows") ||
  navigator.platform.toLowerCase().includes("win");

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

interface EnvVar {
  key: string;
  value: string;
}

function envVarsToMap(vars: EnvVar[]): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  for (const v of vars) {
    if (v.key.trim()) {
      result[v.key.trim()] = v.value;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function LocalSessionForm({ config, onChange, mode = "create" }: LocalSessionFormProps) {
  const [envVars, setEnvVars] = useState<EnvVar[]>(() => {
    const env = config.envConfig?.env || {};
    return Object.entries(env).map(([key, value]) => ({ key, value }));
  });

  useEffect(() => {
    if (mode === "create") {
      onChange({});
      setEnvVars([]);
    }
  }, [mode]);

  const updateEnvVars = (next: EnvVar[]) => {
    setEnvVars(next);
    const envMap = envVarsToMap(next);
    onChange({
      ...config,
      envConfig: envMap ? { env: envMap } : undefined,
    });
  };

  return (
    <>
      <FormField label="Shell">
        <select
          value={config.shell || ""}
          onChange={(e) => onChange({ ...config, shell: e.target.value || undefined })}
        >
          {LOCAL_SHELLS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </FormField>
      <FormField label="Initial Directory">
        <input
          type="text"
          placeholder={CWD_PLACEHOLDER}
          value={config.cwd || ""}
          onChange={(e) => onChange({ ...config, cwd: e.target.value })}
        />
      </FormField>
      <FormField label="Arguments">
        <input
          type="text"
          placeholder="--cd /home/user (space separated)"
          value={config.args?.join(" ") || ""}
          onChange={(e) => {
            const value = e.target.value;
            const args = value.trim() ? value.split(/\s+/) : undefined;
            onChange({ ...config, args });
          }}
        />
      </FormField>
      <FormField label="Environment Variables">
        <div className="env-vars-list">
          {envVars.map((env, index) => (
            <div key={index} className="env-var-row">
              <input
                type="text"
                placeholder="KEY"
                value={env.key}
                onChange={(e) => {
                  const next = [...envVars];
                  next[index] = { ...env, key: e.target.value };
                  updateEnvVars(next);
                }}
              />
              <input
                type="text"
                placeholder="VALUE"
                value={env.value}
                onChange={(e) => {
                  const next = [...envVars];
                  next[index] = { ...env, value: e.target.value };
                  updateEnvVars(next);
                }}
              />
              <button
                type="button"
                onClick={() => {
                  const next = envVars.filter((_, i) => i !== index);
                  updateEnvVars(next);
                }}
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => updateEnvVars([...envVars, { key: "", value: "" }])}
          >
            Add Variable
          </button>
        </div>
      </FormField>
    </>
  );
}