import { useMemo } from "react";
import { useSavedLaunchConfigs } from "../../../sessions";
import {
  type SavedTerminalConfig,
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
 * on top of an already-saved SSH or Local
 * shell config; the form lists those saved configs as a "Base
 * Configuration" dropdown so the user picks the transport by
 * picking the base, not by exposing a separate transport toggle.
 *
 * Submitting the dialog forwards `TmuxSessionConfig` to the backend with
 * `baseConfigId` populated; the dialog looks up the base saved config and,
 * when it is an SSH config, copies the SSH sub-config into
 * `TmuxSessionConfig.ssh` before the backend call. The
 * backend then routes through the SSH exec channel when the base was
 * an SSH config and through a local `tokio::process::Command` child
 * otherwise.
 */
export function TmuxForm({ name, onNameChange, config, onConfigChange, mode }: TmuxFormProps) {
  const { savedConfigs } = useSavedLaunchConfigs();

  // Only SSH + Local saved configs are valid bases for a tmux terminal.
  // (tmux-pane configs are excluded — nesting tmux inside tmux is not
  // supported, and the dialog already filters that case at submit time.)
  const baseOptions: FormSelectOption[] = useMemo(() => {
    const eligible: SavedTerminalConfig[] = savedConfigs.filter(
      (c) => c.type === "local" || c.type === "ssh",
    );
    const options: FormSelectOption[] = [{ value: "", label: "Select a saved config…" }];
    for (const c of eligible) {
      const transportLabel = c.type === "ssh" ? "SSH" : "Shell";
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
          placeholder="Auto-generated if empty"
          value={name || undefined}
          onChange={(v) => onNameChange(v ?? "")}
        />
      </div>

      <div className="terminal-section">
        <div className="terminal-section__title">Base Configuration</div>
        <FormSelectField
          label="Rides on"
          value={config.baseConfigId ?? ""}
          onChange={(v) => onConfigChange({ ...config, baseConfigId: v || undefined })}
          options={baseOptions}
        />
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

export default TmuxForm;
