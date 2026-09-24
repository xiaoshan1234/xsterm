/**
 * createLocalSession — create a local PTY session and bind it to a new
 * window in the active workspace.
 *
 * Flow:
 * 1. Call `infra.createLocal` to spin up the backend PTY.
 * 2. Build the frontend `Session` view-model via `buildFrontendSession`.
 * 3. Persist a `PersistedSessionConfig` (so the sidebar can re-open it).
 * 4. Add the session to the session store.
 * 5. Insert a new `Window` into the active workspace (creating one if
 *    none exists yet).
 */
import * as tauri from "../../infra/tauri/commands/sessions";
import { useSessionStore } from "../../service/session/store";
import { useWorkspaceStore } from "../../service/workspace/store";
import { usePersistenceStore } from "../../service/persistence/store";
import { buildFrontendSession } from "../../app/rules/sessionRules";
import { createLeafPane, generateId } from "../../app/rules/paneTree";
import type {
  LocalSessionConfig,
  PersistedSessionConfig,
  Session,
  SessionDisplayConfig,
} from "../../model";

export async function createLocalSession(
  config: LocalSessionConfig,
  save: boolean = true,
  displayConfig?: SessionDisplayConfig,
): Promise<Session> {
  const configId = generateId();
  const info = await tauri.createLocal(config);
  const session = buildFrontendSession(info, configId, "local", displayConfig);

  if (save) {
    const saved: PersistedSessionConfig = {
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
  attachSessionToNewWindow(session);

  return session;
}

function attachSessionToNewWindow(session: Session): void {
  const workspaceStore = useWorkspaceStore.getState();
  const workspaces = workspaceStore.workspaces;
  const activeId = workspaceStore.activeWorkspaceId ?? workspaces[0]?.id;
  if (!activeId) return;

  const rootPane = createLeafPane(100, session.id, session.configId);
  workspaceStore.addWindow(activeId, {
    id: generateId(),
    name: session.name,
    rootPane,
    activePaneId: rootPane.id,
    kind: "terminal",
  });
}
