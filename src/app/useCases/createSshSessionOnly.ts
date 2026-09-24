/**
 * createSshSessionOnly — create an SSH session but do NOT auto-create
 * a window. Mirrors `createLocalSessionOnly`.
 */
import * as tauri from "../../infra/tauri/commands/sessions";
import { useSessionStore } from "../../service/session/store";
import { usePersistenceStore } from "../../service/persistence/store";
import { buildFrontendSession } from "../../app/rules/sessionRules";
import { generateId } from "../../app/rules/paneTree";
import type {
  PersistedSessionConfig,
  Session,
  SessionDisplayConfig,
  SSHSessionConfig,
} from "../../model";

export async function createSshSessionOnly(
  config: SSHSessionConfig,
  shouldSave: boolean = true,
  displayConfig?: SessionDisplayConfig,
): Promise<Session> {
  const configId = generateId();
  const info = await tauri.createSsh(config);
  const session = buildFrontendSession(info, configId, "ssh", displayConfig);

  if (shouldSave) {
    const saved: PersistedSessionConfig = {
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
