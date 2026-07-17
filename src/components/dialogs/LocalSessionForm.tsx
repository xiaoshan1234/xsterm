import { useEffect } from "react";
import { LocalSessionSpec } from "../../types/session";
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
  value: LocalSessionSpec;
  onChange: (value: LocalSessionSpec) => void;
  mode?: "create" | "edit";
  disabled?: boolean;
}

export function LocalSessionForm({ value, onChange, mode = "create", disabled }: LocalSessionFormProps) {
  useEffect(() => {
    if (mode === "create") {
      onChange({});
    }
  }, [mode]);

  return (
    <>
      <FormField label="Shell">
        <select
          value={value.shell || ""}
          onChange={(e) => onChange({ ...value, shell: e.target.value || undefined })}
          disabled={disabled}
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
          value={value.cwd || ""}
          onChange={(e) => onChange({ ...value, cwd: e.target.value })}
          disabled={disabled}
        />
      </FormField>
      <FormField label="Arguments">
        <input
          type="text"
          placeholder="--cd /home/user (space separated)"
          value={value.args?.join(" ") || ""}
          onChange={(e) => {
            const v = e.target.value;
            const args = v.trim() ? v.split(/\s+/) : undefined;
            onChange({ ...value, args });
          }}
          disabled={disabled}
        />
      </FormField>
    </>
  );
}
