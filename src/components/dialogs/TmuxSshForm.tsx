import { type SSHSessionConfig, type TmuxCcConfig } from "../../types/session";
import { SshSessionForm } from "./SshSessionForm";
import { FormTextField } from "./FormTextField";

interface TmuxSshFormProps {
  /** Display name shown in xsterm chrome. Persisted on the dialog's
   * top-level `name` state and copied onto `TmuxCcConfig.name` at
   * submit time. */
  name: string;
  onNameChange: (name: string) => void;
  /** tmux-over-ssh specific fields. The dialog owns the state and
   * updates it through this callback as the user types. */
  config: TmuxCcConfig;
  onConfigChange: (config: TmuxCcConfig) => void;
}

const DEFAULT_SSH: SSHSessionConfig = {
  host: "",
  port: 22,
  username: "",
  auth_type: "password",
  password: "",
  key_file: "",
  passphrase: "",
};

/**
 * tmux-over-SSH form for the Create Session dialog's
 * "Tmux (SSH)" top tab. Composes the existing {@link SshSessionForm}
 * (which already handles host / port / username / auth / connection
 * options) with the tmux-specific fields from {@link TmuxLocalForm}
 * (session name, socket name, start command).
 *
 * The form holds a single `TmuxCcConfig` state — the SSH sub-config
 * lives under `config.ssh` and is set / cleared as the user types.
 * Submitting the dialog forwards the entire `TmuxCcConfig` to the
 * backend, which routes through the SSH exec channel when
 * `config.ssh` is set.
 */
export function TmuxSshForm({
  name,
  onNameChange,
  config,
  onConfigChange,
}: TmuxSshFormProps) {
  const ssh: SSHSessionConfig = config.ssh ?? DEFAULT_SSH;

  const updateSsh = (next: SSHSessionConfig) => {
    onConfigChange({ ...config, ssh: next });
  };

  const updateTmux = (patch: Partial<TmuxCcConfig>) => {
    onConfigChange({ ...config, ...patch });
  };

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
        <div className="session-section__title">Remote tmux -CC</div>
        <SshSessionForm config={ssh} onChange={updateSsh} />
      </div>

      <div className="session-section">
        <div className="session-section__title">Tmux Control Mode</div>

        <FormTextField
          label="Tmux Session Name"
          placeholder="leave blank to auto-generate"
          value={config.tmuxSessionName}
          onChange={(tmuxSessionName) =>
            updateTmux({ tmuxSessionName: tmuxSessionName ?? undefined })
          }
        />

        <FormTextField
          label="Socket Name"
          placeholder="default"
          value={config.socketName}
          onChange={(socketName) =>
            updateTmux({ socketName: socketName ?? undefined })
          }
        />

        <FormTextField
          label="Start Command"
          placeholder="shell command, e.g. /bin/zsh"
          value={config.startCommand}
          onChange={(startCommand) =>
            updateTmux({ startCommand: startCommand ?? undefined })
          }
        />
      </div>
    </div>
  );
}

export default TmuxSshForm;
