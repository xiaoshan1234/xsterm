/**
 * createTmuxSessionOnly — create a tmux session without auto-creating
 * any xsterm window. Used by PaneInitCard / split flows.
 */
import * as tmuxTauri from "../../infra/tauri/commands/tmux";
import { useSessionStore } from "../../service/session/store";
import { usePersistenceStore } from "../../service/persistence/store";
import { buildFrontendSession } from "../../app/rules/sessionRules";
import { generateId } from "../../app/rules/paneTree";
import type { SavedSessionConfig, Session, SessionDisplayConfig, TmuxCcConfig } from "../../model";

export async function createTmuxSessionOnly(
  config: TmuxCcConfig,
  save: boolean = true,
  displayConfig?: SessionDisplayConfig,
): Promise<Session> {
  const configId = generateId();
  const info = await tmuxTauri.createTmux(config);
  const session = buildFrontendSession(info, configId, "tmux-cc", displayConfig);

  if (save) {
    const saved: SavedSessionConfig = {
      id: configId,
      name: info.name,
      version: 1,
      type: "tmux-cc",
      config,
      displayConfig,
    };
    usePersistenceStore.getState().upsertSavedConfig(saved);
  }

  useSessionStore.getState().addSession(session);
  return session;
}
