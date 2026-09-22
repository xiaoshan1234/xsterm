/**
 * createSshSession — create an SSH session and bind it to a new window
 * in the active workspace.
 *
 * Mirrors `createLocalSession` but routes through `infra.createSsh`.
 */
import * as tauri from "../../infra/tauri/commands/sessions";
import { useSessionStore } from "../../service/session/store";
import { useWorkspaceStore } from "../../service/workspace/store";
import { usePersistenceStore } from "../../service/persistence/store";
import { buildFrontendSession } from "../../app/rules/sessionRules";
import { createLeafPane, generateId } from "../../app/rules/paneTree";
import type {
  SavedSessionConfig,
  Session,
  SessionDisplayConfig,
  SSHSessionConfig,
} from "../../model";

export async function createSshSession(
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
