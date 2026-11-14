import { useMemo } from "react";
import { useSavedLaunchConfigs } from "../../../sessions";
import {
  type SavedTerminalConfig,
  type SshConfig,
  type TmuxSessionConfig,
} from "../../../../models/legacy/terminal";
import { FormSelectField, type FormSelectOption } from "../../../../shared/ui/FormSelectField";
import { FormTextField } from "../../../../shared/ui/FormTextField";

interface TmuxFormProps {
  /** Display name shown in xsterm chrome. Persisted on the dialog's top-level
   * `name` state and copied onto `TmuxSessionConfig.name` at submit time. */
  name: string;
  onNameChange: (name: string) => void;
  /** tmux-pane specific fields. The dialog owns the state and updates it
   * through this callback as the user types. `baseConfigId` lives in
   * the same object so the dialog can persist it without an extra
   * piece of state. */
  config: TmuxSessionConfig;
  onConfigChange: (config: TmuxSessionConfig) => void;
  mode: "attach" | "create";
}

/**
 * tmux control-mode form for the Attach Tmux dialog. A tmux terminal rides
 * on top of an already-saved SSH, WSL, or Local shell config; the form lists
 * those saved configs as a "Base
 * Configuration" dropdown so the user picks the transport by
 * picking the base, not by exposing a separate transport toggle.
 *
 * Submitting the dialog forwards `TmuxSessionConfig` to the backend with
 * `baseConfigId` populated; the dialog looks up the base saved config and,
 * when it is an SSH config, copies the SSH sub-config into
 * `TmuxSessionConfig.ssh` before the backend call. The
 * backend then routes through SSH, `wsl.exe --exec tmux`, or a local tmux
 * process according to the selected base.
 */
export function TmuxForm({ name, onNameChange, config, onConfigChange, mode }: TmuxFormProps) {
  const { savedConfigs } = useSavedLaunchConfigs();
  const selectedBase = savedConfigs.find((candidate) => candidate.id === config.baseConfigId);
  const isWslBase = isTmuxWslBaseConfig(selectedBase);

  // Only SSH + Local saved configs are valid bases for a tmux terminal.
  // (tmux-pane configs are excluded — nesting tmux inside tmux is not
  // supported, and the dialog already filters that case at submit time.)
  const baseOptions: FormSelectOption[] = useMemo(() => {
    const eligible: SavedTerminalConfig[] = savedConfigs.filter(
      (c) => c.type === "local" || c.type === "ssh",
    );
    const options: FormSelectOption[] = [{ value: "", label: "Select a saved config…" }];
    for (const c of eligible) {
      const transportLabel = c.type === "ssh" ? "SSH" : isTmuxWslBaseConfig(c) ? "WSL" : "Shell";
      options.push({
        value: c.id,
        label: `${c.name}  ·  ${transportLabel}`,
      });
    }
    return options;
  }, [savedConfigs]);

  return (
    <div className="terminal-tab">
      <div className="terminal-tab__common">
        <FormTextField
          label="Display Name"
          placeholder="Defaults to <session>:<socket>"
          value={name || undefined}
          onChange={(v) => onNameChange(v ?? "")}
        />
      </div>

      <div className="terminal-section">
        <div className="terminal-section__title">Base Configuration</div>
        <FormSelectField
          label="Rides on"
          value={config.baseConfigId ?? ""}
          onChange={(v) =>
            onConfigChange({
              ...config,
              baseConfigId: v || undefined,
              transport: undefined,
              wslDistribution: undefined,
            })
          }
          options={baseOptions}
        />
        {isWslBase && (
          <>
            <div className="terminal-tab__hint">
              tmux runs through wsl.exe and keeps its windows and panes inside xsterm.
            </div>
            <FormTextField
              label="WSL Distribution"
              placeholder="default distribution"
              value={config.wslDistribution}
              onChange={(wslDistribution) =>
                onConfigChange({ ...config, wslDistribution: wslDistribution ?? undefined })
              }
            />
          </>
        )}
      </div>

      <div className="terminal-section">
        <div className="terminal-section__title">Tmux Control Mode</div>

        <FormTextField
          label="Tmux Session Name"
          placeholder={
            mode === "attach" ? "existing session name, e.g. work" : "leave blank to auto-generate"
          }
          value={config.tmuxSessionName}
          onChange={(tmuxSessionName) =>
            onConfigChange({ ...config, tmuxSessionName: tmuxSessionName ?? undefined })
          }
        />

        <FormTextField
          label="Socket Name"
          placeholder="default"
          value={config.socketName}
          onChange={(socketName) =>
            onConfigChange({ ...config, socketName: socketName ?? undefined })
          }
        />

        {mode === "create" && (
          <FormTextField
            label="Start Command"
            placeholder="shell command, e.g. /bin/zsh"
            value={config.startCommand}
            onChange={(startCommand) =>
              onConfigChange({ ...config, startCommand: startCommand ?? undefined })
            }
          />
        )}
      </div>
    </div>
  );
}

export function isTmuxWslBaseConfig(config: SavedTerminalConfig | undefined): boolean {
  return config?.type === "local" && config.config.shellTemplate === "wsl";
}

export function buildTmuxConfigForBase(
  config: TmuxSessionConfig,
  base: SavedTerminalConfig,
): TmuxSessionConfig {
  const baseConfigFields: TmuxSessionConfig = {
    ...config,
    transport: undefined,
    wslDistribution: undefined,
    ssh: undefined,
  };
  if (base.type === "ssh") {
    return { ...baseConfigFields, ssh: base.config as SshConfig };
  }
  if (isTmuxWslBaseConfig(base)) {
    const wslDistribution = config.wslDistribution?.trim();
    return {
      ...baseConfigFields,
      transport: "wsl",
      ...(wslDistribution ? { wslDistribution } : {}),
    };
  }
  return { ...baseConfigFields, transport: "local" };
}

export default TmuxForm;
