import { type TmuxCcConfig } from "../../types/session";
import { FormTextField } from "./FormTextField";

interface TmuxLocalFormProps {
  /** Display name shown in xsterm chrome. Persisted on the dialog's top-level
   * `name` state and copied onto `TmuxCcConfig.name` at submit time. */
  name: string;
  onNameChange: (name: string) => void;
  /** tmux-cc specific fields. The dialog owns the state and updates it
   * through this callback as the user types. */
  config: TmuxCcConfig;
  onConfigChange: (config: TmuxCcConfig) => void;
}

/**
 * minimal tmux control-mode form for the Create Session dialog's
 * "Tmux" top tab. Four fields: display name, tmux session name, socket name,
 * start command. All tmux-specific fields are optional — empty `TmuxCcConfig`
 * produces a `tmux -CC new-session` with the user's default shell.
 *
 * Sidebar items (Terminal / Appearance / Input / Logging) are shared with
 * the Shell and SSH tabs and are rendered by `CreateSessionDialog` directly
 * using `SessionDisplayConfig` state.
 */
export function TmuxLocalForm({
  name,
  onNameChange,
  config,
  onConfigChange,
}: TmuxLocalFormProps) {
  return (
    <div className="session-tab">
      <div className="session-tab__common">
        <FormTextField
          label="Display Name"
          placeholder="Auto-generated if empty"
          value={name || undefined}
          onChange={(v) => onNameChange(v ?? "")}
        />
      </div>

      <div className="session-section">
        <div className="session-section__title">Tmux Control Mode</div>

        <FormTextField
          label="Tmux Session Name"
          placeholder="leave blank to auto-generate"
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

        <FormTextField
          label="Start Command"
          placeholder="shell command, e.g. /bin/zsh"
          value={config.startCommand}
          onChange={(startCommand) =>
            onConfigChange({ ...config, startCommand: startCommand ?? undefined })
          }
        />
      </div>
    </div>
  );
}

export default TmuxLocalForm;