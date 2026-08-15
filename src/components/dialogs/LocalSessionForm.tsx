import { useEffect, useState } from "react";
import { LocalSessionConfig } from "../../types/session";
import { FormField } from "../ui/FormField";
import "./LocalSessionForm.css";

const isWindows = navigator.userAgent.toLowerCase().includes("windows") ||
  navigator.platform.toLowerCase().includes("win");

const SHELL_TEMPLATES: Array<{ value: string; label: string }> = [
  { value: "", label: "Default (per OS)" },
  { value: "powershell", label: "PowerShell" },
  { value: "powershell7", label: "PowerShell 7" },
  { value: "cmd", label: "CMD" },
  { value: "wsl", label: "WSL (Default Distro)" },
  { value: "bash", label: "Bash" },
  { value: "zsh", label: "Zsh" },
  { value: "sh", label: "Sh" },
  { value: "custom", label: "Custom (specify path)" },
];

const TERM_TYPES = [
  { value: "xterm-256color", label: "xterm-256color (recommended)" },
  { value: "xterm", label: "xterm" },
  { value: "vt100", label: "vt100" },
  { value: "screen", label: "screen" },
];

const CHARSETS = [
  { value: "utf-8", label: "UTF-8 (recommended)" },
  { value: "gbk", label: "GBK" },
];

const CWD_PLACEHOLDER = isWindows ? "C:\\Users\\you or %USERPROFILE%" : "/home/user or ~";
const SHELL_PATH_PLACEHOLDER = isWindows ? "C:\\path\\to\\shell.exe" : "/path/to/shell";

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

// Empty input → undefined so backend #[serde(default)] takes over.
function parseOptionalInt(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function LocalSessionForm({ config, onChange, mode = "create" }: LocalSessionFormProps) {
  const [envVars, setEnvVars] = useState<EnvVar[]>(() => {
    const env = config.envConfig?.env || {};
    return (Object.entries(env) as [string, string][]).map(([key, value]) => ({ key, value }));
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

  // Resolve the shellTemplate select value. Priority:
  //   1. Explicit shellTemplate on the config (e.g. "powershell", "bash").
  //   2. Infer "custom" when a free-form shell path is already set.
  //   3. Empty string → "Default (per OS)" in the UI, undefined in state.
  const shellTemplateValue: string = (() => {
    if (config.shellTemplate) return config.shellTemplate;
    if (config.shell) return "custom";
    return "";
  })();

  return (
    <>
      <FormField label="Shell Template">
        <select
          value={shellTemplateValue}
          onChange={(e) => {
            const v = e.target.value;
            onChange({
              ...config,
              shellTemplate: v === ""
                ? undefined
                : (v as NonNullable<LocalSessionConfig["shellTemplate"]>),
            });
          }}
        >
          {SHELL_TEMPLATES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </FormField>

      {shellTemplateValue === "custom" && (
        <FormField label="Shell Path">
          <input
            type="text"
            placeholder={SHELL_PATH_PLACEHOLDER}
            value={config.shell || ""}
            onChange={(e) =>
              onChange({ ...config, shell: e.target.value || undefined })
            }
          />
        </FormField>
      )}

      <FormField label="Terminal Type">
        <select
          value={config.termType || "xterm-256color"}
          onChange={(e) => onChange({ ...config, termType: e.target.value })}
        >
          {TERM_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </FormField>

      <FormField label="Charset">
        <select
          value={config.charset || "utf-8"}
          onChange={(e) => onChange({ ...config, charset: e.target.value })}
        >
          {CHARSETS.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </FormField>

      <FormField label="Startup Command">
        <input
          type="text"
          placeholder='echo "Hello, world!"'
          value={config.startupCommand || ""}
          onChange={(e) =>
            onChange({ ...config, startupCommand: e.target.value || undefined })
          }
        />
      </FormField>

      <FormField label="Startup Delay (ms)">
        <input
          type="number"
          placeholder="0"
          min={0}
          value={config.startupDelayMs ?? ""}
          onChange={(e) =>
            onChange({ ...config, startupDelayMs: parseOptionalInt(e.target.value) })
          }
        />
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
