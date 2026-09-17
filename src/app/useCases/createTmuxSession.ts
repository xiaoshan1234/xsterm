/**
 * createTmuxSession — create a tmux control-mode session and install
 * the bootstrap `tmux-control` + xsterm Window into the active workspace.
 *
 * Routing: when the server already has a session with the same
 * `tmuxSessionName`, route through `attachTmux` instead of `createTmux`
 * to avoid leaving a phantom empty window on top of existing panes.
 */
import * as tmuxTauri from "../../infra/tauri/commands/tmux";
import { useSessionStore } from "../../service/session/store";
import { useWorkspaceStore } from "../../service/workspace/store";
import { usePersistenceStore } from "../../service/persistence/store";
import { buildFrontendSession } from "../../model/rules/sessionRules";
import { createLeafPane, generateId } from "../../model/entities/paneTree";
import type {
  SavedSessionConfig,
  Session,
  SessionDisplayConfig,
  TmuxCcConfig,
  Window,
} from "../../model/entities";

export async function createTmuxSession(
  config: TmuxCcConfig,
  save: boolean = true,
  displayConfig?: SessionDisplayConfig,
): Promise<Session> {
  const configId = generateId();
  let info: Awaited<ReturnType<typeof tmuxTauri.createTmux>>;

  try {
    const exists = await tmuxTauri.probeTmuxSessionExists(config);
    info = exists ? await tmuxTauri.attachTmux(config) : await tmuxTauri.createTmux(config);
  } catch (err) {
    // Probe is best-effort; fall through to create path.
    info = await tmuxTauri.createTmux(config);
  }

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
  insertTmuxControlAndBootstrapWindow(session, config.tmuxSessionName);
  return session;
}

/**
 * Install the tmux-control Window + bootstrap xsterm Window into the
 * active workspace, creating a default workspace on demand.
 *
 * TODO: edge cases from legacy `insertTmuxControlAndBootstrapWindow`:
 * - dedupe against the async `tmux-window-added` listener race;
 * - merge with active workspace's existing `tmux-control` window.
 */
function insertTmuxControlAndBootstrapWindow(
  session: Session,
  tmuxSessionName: string | undefined,
): void {
  if (session.type !== "tmux-cc" || session.tmuxControllerId === undefined) return;

  const controllerId = session.tmuxControllerId;
  const tmuxName = tmuxSessionName ?? `tmux-${controllerId}`;
  const rootPane = createLeafPane(100, session.id, session.configId);

  const workspaceStore = useWorkspaceStore.getState();
  const workspaces = workspaceStore.workspaces;
  const targetId = workspaceStore.activeWorkspaceId ?? workspaces[0]?.id;
  if (!targetId) {
    // Caller is expected to ensure a workspace exists.
    return;
  }

  const controlWindow: Window = {
    id: generateId(),
    name: tmuxName,
    rootPane: { id: generateId(), type: "leaf", size: 100 },
    activePaneId: null,
    windowType: "tmux-control",
    tmuxControlWindowId: controllerId,
    tmuxControlName: tmuxName,
  };

  const bootstrapWindow: Window = {
    id: generateId(),
    name: tmuxName,
    rootPane,
    activePaneId: rootPane.id,
    windowType: "terminal",
    ...(session.xstermWindowId !== undefined ? { xstermWindowId: session.xstermWindowId } : {}),
  };

  workspaceStore.setWorkspaces((prev) => {
    const target = prev.find((w) => w.id === targetId);
    if (!target) return prev;
    const hasControlWindow = target.windows.some(
      (w) => w.windowType === "tmux-control" && w.tmuxControlWindowId === controllerId,
    );
    const baseWindows = hasControlWindow ? target.windows : [controlWindow, ...target.windows];
    return prev.map((workspace) =>
      workspace.id === targetId
        ? {
            ...workspace,
            windows: [...baseWindows, bootstrapWindow],
            activeWindowId: bootstrapWindow.id,
          }
        : workspace,
    );
  });
}
