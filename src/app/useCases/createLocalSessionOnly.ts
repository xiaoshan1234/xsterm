/**
 * createLocalSessionOnly — create a local PTY session but do NOT
 * auto-create a window. Used by PaneInitCard / split flows where the
 * consumer attaches the session to an existing pane.
 */
import * as tauri from "../../infra/tauri/commands/sessions";
import { useSessionStore } from "../../service/session/store";
import { usePersistenceStore } from "../../service/persistence/store";
import { buildFrontendSession } from "../../model/rules/sessionRules";
import { generateId } from "../../model/entities/paneTree";
import type { LocalSessionConfig, SavedSessionConfig, Session, SessionDisplayConfig } from "../../model/entities";

export async function createLocalSessionOnly(
  config: LocalSessionConfig,
  save: boolean = true,
  displayConfig?: SessionDisplayConfig,
): Promise<Session> {
  const configId = generateId();
  const info = await tauri.createLocal(config);
  const session = buildFrontendSession(info, configId, "local", displayConfig);

  if (save) {
    const saved: SavedSessionConfig = {
      id: configId,
      name: info.name,
      version: 1,
      type: "local",
      config,
      displayConfig,
    };
    usePersistenceStore.getState().upsertSavedConfig(saved);
  }

  useSessionStore.getState().addSession(session);
  return session;
}
