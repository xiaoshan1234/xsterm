/**
 * openSavedSession — recreate a session from a saved config and bind
 * it to a new window in the active workspace.
 *
 * Routing by saved-config type: local / ssh / tmux-cc each go through
 * the matching `infra.createXxx` wrapper. tmux-cc does NOT auto-create
 * a window (the `tmux-window-added` listener installs the windows
 * asynchronously).
 */
import * as tauri from "../../infra/tauri/commands/sessions";
import * as tmuxTauri from "../../infra/tauri/commands/tmux";
import { useSessionStore } from "../../service/session/store";
import { useWorkspaceStore } from "../../service/workspace/store";
import { usePersistenceStore } from "../../service/persistence/store";
import { buildFrontendSession, dispatchByType } from "../../app/rules/sessionRules";
import { createLeafPane, generateId } from "../../app/rules/paneTree";
import type { LocalSessionConfig, Session, SSHSessionConfig, TmuxCcConfig } from "../../model";

export async function openSavedSession(configId: string): Promise<Session> {
  const config = usePersistenceStore.getState().savedConfigs.find((c) => c.id === configId);
  if (!config) throw new Error("Saved config not found");

  const info = await dispatchByType(
    config.type,
    () => tauri.createLocal(config.config as LocalSessionConfig),
    () => tauri.createSsh(config.config as SSHSessionConfig),
    () => tmuxTauri.createTmux(config.config as TmuxCcConfig),
  );

  const sessionType = config.type === "tmux-cc" ? "tmux-cc" : config.type;
  const session = buildFrontendSession(info, config.id, sessionType, config.displayConfig);
  useSessionStore.getState().addSession(session);

  if (sessionType !== "tmux-cc") {
    attachSessionToNewWindow(session);
  }

  return session;
}

function attachSessionToNewWindow(session: Session): void {
  const workspaceStore = useWorkspaceStore.getState();
  const activeId = workspaceStore.activeWorkspaceId ?? workspaceStore.workspaces[0]?.id;
  if (!activeId) return;
  const rootPane = createLeafPane(100, session.id, session.configId);
  workspaceStore.addWindow(activeId, {
    id: generateId(),
    name: session.name,
    rootPane,
    activePaneId: rootPane.id,
    windowType: "terminal",
  });
}
