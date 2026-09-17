/**
 * reconnectSession — close the old backend session and create a new
 * one from its saved config. The new session keeps the old
 * `configId`, replacing the old sessionId everywhere it was referenced
 * in pane trees.
 *
 * TODO: legacy edge cases not ported —
 * - `establishingSessionsRef` bookkeeping for in-flight sessions.
 */
import * as tauri from "../../infra/tauri/commands/sessions";
import * as tmuxTauri from "../../infra/tauri/commands/tmux";
import { useSessionStore } from "../../service/session/store";
import { useWorkspaceStore } from "../../service/workspace/store";
import { usePersistenceStore } from "../../service/persistence/store";
import { clearSessionOutput } from "../../infra/buffers/sessionOutputBuffer";
import { buildFrontendSession, dispatchByType } from "../../model/rules/sessionRules";
import { replaceSessionIdInPaneTree } from "../../model/entities/paneTree";
import { withRecomputedSessionIds } from "../../model/rules/workspaceRules";
import type {
  LocalSessionConfig,
  Session,
  SSHSessionConfig,
  TmuxCcConfig,
} from "../../model/entities";

export async function reconnectSession(id: number): Promise<Session> {
  const sessions = useSessionStore.getState().sessions;
  const oldSession = sessions.find((s) => s.id === id);
  if (!oldSession) throw new Error("Session not found");
  if (oldSession.capabilities && !oldSession.capabilities.supportsReconnect) {
    throw new Error("Reconnect not supported for this transport");
  }

  const config = usePersistenceStore
    .getState()
    .savedConfigs.find((c) => c.id === oldSession.configId);
  if (!config) throw new Error("Saved config not found for session");

  const info = await dispatchByType(
    config.type,
    () => tauri.createLocal(config.config as LocalSessionConfig),
    () => tauri.createSsh(config.config as SSHSessionConfig),
    () => tmuxTauri.createTmux(config.config as TmuxCcConfig),
  );

  const newSession = buildFrontendSession(
    info,
    oldSession.configId,
    oldSession.type,
    config.displayConfig,
  );

  const sessionStore = useSessionStore.getState();
  sessionStore.addSession(newSession);
  sessionStore.removeSession(id);

  const wsStore = useWorkspaceStore.getState();
  wsStore.setWorkspaces((prev) =>
    prev.map((workspace) =>
      withRecomputedSessionIds({
        ...workspace,
        windows: workspace.windows.map((window) => ({
          ...window,
          rootPane: replaceSessionIdInPaneTree(window.rootPane, id, newSession.id),
        })),
      }),
    ),
  );

  try {
    await tauri.closeSession(id);
  } catch (e) {
    console.error("Failed to close old session backend during reconnect:", e);
  } finally {
    clearSessionOutput(id);
  }

  return newSession;
}
