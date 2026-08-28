import { useEffect, useState } from "react";
import { type LocalSessionConfig, type SessionDisplayConfig } from "../../types/session";
import { FormSelectField } from "./FormSelectField";
import { FormTextField } from "./FormTextField";
import "./ShellSettingsPanel.css";

interface ShellSettingsPanelProps {
  localConfig: LocalSessionConfig;
  onLocalConfigChange: (config: LocalSessionConfig) => void;
  displayConfig?: SessionDisplayConfig;
  onDisplayConfigChange: (config: SessionDisplayConfig) => void;
}

const TERMINAL_TYPES = [
  { value: "xterm-256color", label: "xterm-256color" },
  { value: "xterm", label: "xterm" },
  { value: "vt100", label: "vt100" },
  { value: "screen", label: "screen" },
];

const CHARSETS = [
  { value: "utf-8", label: "UTF-8" },
  { value: "gbk", label: "GBK" },
];

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

export function ShellSettingsPanel({
  localConfig,
  onLocalConfigChange,
  displayConfig = {},
  onDisplayConfigChange,
}: ShellSettingsPanelProps) {
  const [envVars, setEnvVars] = useState<EnvVar[]>(() => {
    const env = localConfig.envConfig?.env || {};
    return (Object.entries(env) as [string, string][]).map(([key, value]) => ({ key, value }));
  });

  // Defensive sync: re-derive `envVars` from `localConfig` whenever the parent
  // updates `localConfig` externally (e.g. dialog reset, saved session load).
  // `updateEnvVars` already syncs on user input; this protects against cases
  // where the parent changes `localConfig` without going through this component.
  // `setEnvVars(next)` with the same content is a no-op per React's Object.is
  // comparison, so this won't loop when the user types.
  useEffect(() => {
    const env = localConfig.envConfig?.env || {};
    const next = (Object.entries(env) as [string, string][]).map(
      ([key, value]) => ({ key, value }),
    );
    setEnvVars(next);
  }, [localConfig]);

  const updateEnvVars = (next: EnvVar[]) => {
    setEnvVars(next);
    const envMap = envVarsToMap(next);
    onLocalConfigChange({
      ...localConfig,
      envConfig: envMap ? { env: envMap } : undefined,
    });
  };

  return (
    <div className="shell-settings-panel">
      <div className="shell-settings-panel__section">
        <h3 className="shell-settings-panel__section-title">Terminal</h3>
        <div className="shell-settings-panel__section-content">
          <FormSelectField
            label="Terminal Type"
            value={displayConfig.terminalType ?? "xterm-256color"}
            onChange={(terminalType) => onDisplayConfigChange({ ...displayConfig, terminalType })}
            options={TERMINAL_TYPES}
          />
          <FormSelectField
            label="Charset"
            value={displayConfig.charset ?? "utf-8"}
            onChange={(charset) => onDisplayConfigChange({ ...displayConfig, charset })}
            options={CHARSETS}
          />
        </div>
      </div>

      <div className="shell-settings-panel__section">
        <h3 className="shell-settings-panel__section-title">Startup</h3>
        <div className="shell-settings-panel__section-content">
          <FormTextField
            label="Startup Command"
            placeholder='echo "Hello, world!"'
            value={localConfig.startupCommand}
            onChange={(startupCommand) => onLocalConfigChange({ ...localConfig, startupCommand })}
          />

          <div className="shell-settings-panel__delay-row">
            <span className="shell-settings-panel__delay-label">Delay:</span>
            <input
              className="shell-settings-panel__delay-input"
              type="number"
              placeholder="0"
              min={0}
              value={localConfig.startupDelayMs ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                onLocalConfigChange({
                  ...localConfig,
                  startupDelayMs: v === "" ? undefined : Number(v),
                });
              }}
            />
            <span className="shell-settings-panel__delay-unit">ms</span>
          </div>

          <FormTextField
            label="Arguments"
            placeholder="--cd /home/user (space separated)"
            value={localConfig.args?.join(" ") ?? undefined}
            onChange={(v) => {
              const args = v?.trim() ? v.trim().split(/\s+/) : undefined;
              onLocalConfigChange({ ...localConfig, args });
            }}
          />

          <div className="form-field">
            <label className="form-field__label">Environment Variables</label>
            <div className="shell-settings-panel__env-list">
              {envVars.map((env, index) => (
                <div key={index} className="shell-settings-panel__env-row">
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
                    className="btn btn--secondary btn--compact"
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
                className="btn btn--secondary"
                onClick={() => updateEnvVars([...envVars, { key: "", value: "" }])}
              >
                Add Variable
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ShellSettingsPanel;
