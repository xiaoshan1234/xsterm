import { useEffect } from "react";
import { LocalSessionConfig } from "../../types/session";
import { FormField } from "../ui/FormField";

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
}

export function LocalSessionForm({ config, onChange }: LocalSessionFormProps) {
  useEffect(() => {
    onChange({});
  }, []);

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
    </>
  );
}
