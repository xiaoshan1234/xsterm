/**
 * saveConfigOnly — persist a session configuration WITHOUT creating a
 * backend session or auto-opening a window. Used by the Create Session
 * dialog's "Save Only" button.
 */
import { usePersistenceStore } from "../../service/persistence/store";
import { generateId } from "../../app/rules/paneTree";
import type {
  LocalSessionConfig,
  SavedSessionConfig,
  SessionDisplayConfig,
  SSHSessionConfig,
  TmuxCcConfig,
} from "../../model";

export function saveConfigOnly(
  type: SavedSessionConfig["type"],
  config: LocalSessionConfig | SSHSessionConfig | TmuxCcConfig,
  displayConfig?: SessionDisplayConfig,
): SavedSessionConfig {
  const configId = generateId();
  const configName = config.name?.trim();

  let saved: SavedSessionConfig;
  if (type === "local") {
    saved = {
      id: configId,
      name: configName || "Local",
      version: 1,
      type: "local",
      config: config as LocalSessionConfig,
      displayConfig,
    };
  } else if (type === "ssh") {
    const sshConfig = config as SSHSessionConfig;
    const user = sshConfig.username?.trim() || "user";
    const host = sshConfig.host?.trim() || "host";
    saved = {
      id: configId,
      name: configName || `${user}@${host}`,
      version: 1,
      type: "ssh",
      config: sshConfig,
      displayConfig,
    };
  } else {
    const tmuxConfig = config as TmuxCcConfig;
    saved = {
      id: configId,
      name: configName || tmuxConfig.tmuxSessionName?.trim() || "Tmux",
      version: 1,
      type: "tmux-cc",
      config: tmuxConfig,
      displayConfig,
    };
  }
  usePersistenceStore.getState().upsertSavedConfig(saved);
  return saved;
}
