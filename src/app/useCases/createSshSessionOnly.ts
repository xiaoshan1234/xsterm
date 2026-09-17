/**
 * createSshSessionOnly — create an SSH session but do NOT auto-create
 * a window. Mirrors `createLocalSessionOnly`.
 */
import * as tauri from "../../infra/tauri/commands/sessions";
import { useSessionStore } from "../../service/session/store";
import { usePersistenceStore } from "../../service/persistence/store";
import { buildFrontendSession } from "../../model/rules/sessionRules";
import { generateId } from "../../model/entities/paneTree";
import type {
  SavedSessionConfig,
  Session,
  SessionDisplayConfig,
  SSHSessionConfig,
} from "../../model/entities";

export async function createSshSessionOnly(
  config: SSHSessionConfig,
  save: boolean = true,
  displayConfig?: SessionDisplayConfig,
): Promise<Session> {
  const configId = generateId();
  const info = await tauri.createSsh(config);
  const session = buildFrontendSession(info, configId, "ssh", displayConfig);

  if (save) {
    const saved: SavedSessionConfig = {
      id: configId,
      name: info.name,
      version: 1,
      type: "ssh",
      config,
      displayConfig,
    };
    usePersistenceStore.getState().upsertSavedConfig(saved);
  }

  useSessionStore.getState().addSession(session);
  return session;
}
