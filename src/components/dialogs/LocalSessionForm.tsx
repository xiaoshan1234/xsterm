import { useEffect, useState } from "react";
import { type LocalSessionConfig } from "../../types/session";
import { FormNumberField } from "./FormNumberField";
import { FormSelectField } from "./FormSelectField";
import { FormTextField } from "./FormTextField";
import "./LocalSessionForm.css";

const isWindows =
  navigator.userAgent.toLowerCase().includes("windows") ||
  navigator.platform.toLowerCase().includes("win");

const SHELL_TEMPLATES: Array<{ value: string; label: string }> = [
  { value: "powershell", label: "PowerShell" },
  { value: "cmd", label: "CMD" },
  { value: "git-bash", label: "Git Bash" },
  { value: "wsl", label: "WSL" },
  { value: "custom", label: "Custom" },
];

const TERM_TYPES = [
  { value: "xterm-256color", label: "xterm-256color" },
  { value: "xterm", label: "xterm" },
  { value: "vt100", label: "vt100" },
  { value: "screen", label: "screen" },
];

const CHARSETS = [
  { value: "utf-8", label: "UTF-8" },
  { value: "gbk", label: "GBK" },
];

const CWD_PLACEHOLDER = isWindows ? "C:\\Users\\you or %USERPROFILE%" : "/home/user or ~";
const SHELL_PATH_PLACEHOLDER = isWindows ? "C:\\path\\to\\shell.exe" : "/path/to/shell";

interface LocalSessionFormProps {
  config: LocalSessionConfig;
  onChange: (config: LocalSessionConfig) => void;
  mode?: "create" | "edit";
  /**
   * When set, render only the matching sub-group:
   *   - "session" → shellTemplate + conditional Shell Path
   *   - "process" → terminal type / charset / startup command+delay /
   *                  cwd / args / env vars
   * When undefined, render all fields (backward-compatible default).
   */
  section?: "session" | "process";
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

export function LocalSessionForm({
  config,
  onChange,
  mode = "create",
  section,
}: LocalSessionFormProps) {
  const [envVars, setEnvVars] = useState<EnvVar[]>(() => {
    const env = config.envConfig?.env || {};
    return (Object.entries(env) as [string, string][]).map(([key, value]) => ({ key, value }));
  });

  // Reset form state on mount when mode is "create".
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

  // Resolve the shellTemplate select value. Priority:
  //   1. Explicit shellTemplate on the config (e.g. "powershell", "bash").
  //   2. Infer "custom" when a free-form shell path is already set.
  //   3. Default to "cmd" when no configuration exists.
  const shellTemplateValue: string = (() => {
    if (config.shellTemplate) return config.shellTemplate;
    if (config.shell) return "custom";
    return "cmd";
  })();

  const showSession = !section || section === "session";
  const showProcess = !section || section === "process";

  return (
    <>
      {showSession && (
        <>
          <FormSelectField
            label="Shell Template"
            value={shellTemplateValue}
            onChange={(v) =>
              onChange({
                ...config,
                shellTemplate: v as NonNullable<LocalSessionConfig["shellTemplate"]>,
              })
            }
            options={SHELL_TEMPLATES}
          />

          {shellTemplateValue === "custom" && (
            <FormTextField
              label="Shell Path"
              placeholder={SHELL_PATH_PLACEHOLDER}
              value={config.shell}
              onChange={(shell) => onChange({ ...config, shell })}
            />
          )}
        </>
      )}

      {showProcess && (
        <>
          <FormSelectField
            label="Terminal Type"
            value={config.termType || "xterm-256color"}
            onChange={(v) => onChange({ ...config, termType: v })}
            options={TERM_TYPES}
          />

          <FormSelectField
            label="Charset"
            value={config.charset || "utf-8"}
            onChange={(v) => onChange({ ...config, charset: v })}
            options={CHARSETS}
          />

          <FormTextField
            label="Startup Command"
            placeholder='echo "Hello, world!"'
            value={config.startupCommand}
            onChange={(startupCommand) => onChange({ ...config, startupCommand })}
          />

          <FormNumberField
            label="Startup Delay (ms)"
            placeholder="0"
            min={0}
            value={config.startupDelayMs}
            onChange={(startupDelayMs) => onChange({ ...config, startupDelayMs })}
          />

          <FormTextField
            label="Initial Directory"
            placeholder={CWD_PLACEHOLDER}
            value={config.cwd || undefined}
            onChange={(cwd) => onChange({ ...config, cwd: cwd ?? "" })}
          />

          <FormTextField
            label="Arguments"
            placeholder="--cd /home/user (space separated)"
            value={config.args?.join(" ") ?? undefined}
            onChange={(v) => {
              const args = v?.trim() ? v.trim().split(/\s+/) : undefined;
              onChange({ ...config, args });
            }}
          />

          <div className="form-field">
            <label className="form-field__label">Environment Variables</label>
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
          </div>
        </>
      )}
    </>
  );
}
