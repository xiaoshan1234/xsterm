/**
 * `useTauriListeners` — bridge Tauri events into the service stores.
 *
 * **Before Commit 5**: subscribed via `@tauri-apps/api/event` and mutated
 * React-local state via `setSessions` / `setWorkspaces`.
 *
 * **After Commit 5**: subscribes via the typed adapters in
 * `src/infra/tauri/events/` and mutates the service stores via
 * `store.getState()`. The bodies of each handler are preserved verbatim
 * from the legacy implementation; only the source of the state changed.
 *
 * The legacy hook also owned `establishingSessionsRef`,
 * `tmuxControllerConfigsRef`, and `tmuxWindowListsRef` — these now
 * live inside `src/service/session/store.ts`. Reads / writes go through
 * `useSessionStore.getState()` (the store keeps the same mutable `.current`
 * ref objects so the synchronous read pattern still works).
 *
 * **Render**: this hook mounts no UI. It's used inside `SessionProvider`
 * to wire event subscriptions to the stores.
 */
import { useEffect } from "react";
import type { CapabilityFlags } from "../../../../model/entities/capabilities";
import type {
  Session,
  SessionType,
  TmuxPaneAddedEvent,
  TmuxPaneRemovedEvent,
  TmuxWindowAddedEvent,
  TmuxWindowClosedEvent,
  TmuxWindowListEntry,
  TmuxWindowRenamedEvent,
  Window,
} from "../../../../model/entities";
import {
  findPaneNode,
  getLeafPaneIds,
  removeSessionAndCollapse,
} from "../../../../model/entities/paneTree";
import { withRecomputedSessionIds } from "../../../../model/rules/workspaceRules";
import {
  subscribeTmuxPaused,
  subscribeTmuxContinued,
  subscribeTmuxControllerExit,
  subscribeTmuxPaneAdded,
  subscribeTmuxPaneRemoved,
  subscribeTmuxWindowAdded,
  subscribeTmuxWindowClosed,
  subscribeTmuxWindowRenamed,
  subscribeTmuxWindowList,
} from "../../../../infra/tauri/events/tmuxEvents";
import { useSessionStore } from "../../../../service/session/store";
import { useWorkspaceStore } from "../../../../service/workspace/store";

/**
 * capability flags mirrored from `CapabilityFlags::for_tmux()`
 * (see `src-tauri/src/models/capabilities.rs`). Tmux panes support
 * resize / reconnect but not local echo; they DO advertise
 * `supportsMultiplex` which is the unlock flag for split UI.
 */
const TMUX_PANE_CAPABILITIES: CapabilityFlags = {
  supportsResize: true,
  supportsReconnect: true,
  supportsLocalEcho: false,
  supportsMultiplex: true,
};

/**
 * Build a Session-shaped entry for a tmux pane that just arrived via
 * the `tmux-pane-added` event. Mirrors what
 * `useSessionActions.helpers.buildFrontendSession` produces for the
 * bootstrap pane (returned by `create_tmux_session`); the `configId`
 * is intentionally absent because splits have no corresponding saved
 * config.
 */
function buildTmuxPaneSession(
  info: {
    id: number;
    name: string;
    tmuxPaneId: string;
    tmuxControllerId: number;
  },
  sessionType: SessionType,
): Session {
  return {
    id: info.id,
    configId: "",
    name: info.name,
    type: "tmux-cc",
    isConnected: true,
    sessionType,
    tmuxPaneId: info.tmuxPaneId,
    tmuxControllerId: info.tmuxControllerId,
    isHidden: false,
    capabilities: TMUX_PANE_CAPABILITIES,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  };
}

export function useTauriListeners(): void {
  useEffect(() => {
    let cancelled = false;
    const unlisteners: (() => void)[] = [];

    // Resolve the per-mount handles to the mutable refs we need. Each
    // ref lives on the store; calling `.current` on the store-owned ref
    // object gives us a synchronous read.
    const getSessionsRef = () => useSessionStore.getState().sessionsRef;
    const getWorkspacesRef = () => useWorkspaceStore.getState().workspacesRef;
    const getEstablishingRef = () => useSessionStore.getState().establishingSessionsRef;
    const getTmuxConfigsRef = () => useSessionStore.getState().tmuxControllerConfigsRef;
    const getTmuxWindowsRef = () => useSessionStore.getState().tmuxWindowListsRef;

    (async () => {
      // session-disconnected / session-closed subscriptions moved to
      // src/service/bridges/sessionBridge.tsx — both bridges share the
      // same infraEventBus, so leaving duplicates here would double-fire.

      // tmux paused / continued markers. These are read-only —
      // we do not mutate session state because the underlying tmux session
      // is still alive and the user can resume typing. A future iteration
      // may flip a `paused` flag on the Session for UI hints.
      const unlistenTmuxPaused = await subscribeTmuxPaused((event) => {
        console.debug("[xsterm] tmux-paused", event);
      }).catch((e) => {
        console.error("Failed to listen tmux-paused:", e);
        return null;
      });
      if (cancelled) {
        unlistenTmuxPaused?.();
        return;
      }
      if (unlistenTmuxPaused) unlisteners.push(unlistenTmuxPaused);

      const unlistenTmuxContinued = await subscribeTmuxContinued((event) => {
        console.debug("[xsterm] tmux-continued", event);
      }).catch((e) => {
        console.error("Failed to listen tmux-continued:", e);
        return null;
      });
      if (cancelled) {
        unlistenTmuxContinued?.();
        return;
      }
      if (unlistenTmuxContinued) unlisteners.push(unlistenTmuxContinued);

      // tmux controller process exit. When the underlying `tmux -CC`
      // child terminates, drop every frontend Session that was bound to it.
      // Mirrors the `session-closed` handler but selects by controller id
      // because one controller owns N panes (= N frontend Session entries).
      //
      // also surface a retry banner by pushing into
      // `tmuxControllerErrors`. Reads the stored config from
      // `tmuxControllerConfigsRef` so the banner can pass it back to
      // `attachTmux` / `createTmux` on Retry. If the controller was
      // never registered (e.g. a Wave 0 test session) we silently skip
      // the banner so we don't show a banner with no retry path.
      //
      // ADR 0009 §2.7: also drop every ordinary tmux-window that
      // belonged to this controller (a tmux-window whose only panes
      // just died becomes leafless and should not stay in the workspace
      // as an empty ghost). The control-window for this controller is
      // intentionally left in place — the user closes it via the tab
      // × button, which routes through `closeWindow` and calls
      // `unmark_attached_tmux`.
      const unlistenTmuxControllerExit = await subscribeTmuxControllerExit((event) => {
        const { controllerId, reason } = event;
        const dead = getSessionsRef().current.filter((s) => s.tmuxControllerId === controllerId);
        const storedConfig = getTmuxConfigsRef().current.get(controllerId);
        if (dead.length > 0) {
          const deadIds = new Set(dead.map((s) => s.id));
          console.warn(
            `[xsterm] tmux-controller-exit controllerId=${controllerId} reason=${reason ?? "(none)"} — dropping ${dead.length} session(s)`,
          );
          for (const id of deadIds) {
            getEstablishingRef().current.delete(id);
          }
          useSessionStore.getState().setSessions((prev) => prev.filter((s) => !deadIds.has(s.id)));
          useWorkspaceStore.getState().setWorkspaces((prev) =>
            prev.map((workspace) => {
              // Drop every ordinary tmux-window whose only panes just died.
              // Control-windows stay so the user can see "this controller
              // is dead" and close it explicitly via the tab UI.
              const surviving: Window[] = [];
              for (const window of workspace.windows) {
                if (window.windowType === "tmux-control") {
                  surviving.push(window);
                  continue;
                }
                let root = window.rootPane;
                for (const id of deadIds) {
                  root = removeSessionAndCollapse(root, id);
                }
                const leafCount = getLeafPaneIds(root).length;
                if (leafCount === 0) continue; // drop the ghost window
                const newActivePaneId = findPaneNode(root, window.activePaneId ?? "")
                  ? window.activePaneId
                  : (getLeafPaneIds(root)[0] ?? null);
                surviving.push({ ...window, rootPane: root, activePaneId: newActivePaneId });
              }
              const nextActiveId = surviving.find((w) => w.id === workspace.activeWindowId)
                ? workspace.activeWindowId
                : (surviving[0]?.id ?? null);
              return withRecomputedSessionIds({
                ...workspace,
                windows: surviving,
                activeWindowId: nextActiveId,
              });
            }),
          );
        }
        // Always clear the per-controller window-list cache so a
        // future attach starts fresh.
        getTmuxWindowsRef().current.delete(controllerId);
        if (storedConfig) {
          useSessionStore.getState().setTmuxControllerErrors((prev) => {
            const next = new Map(prev);
            next.set(controllerId, {
              config: storedConfig,
              reason,
              timestamp: Date.now(),
            });
            return next;
          });
          getTmuxConfigsRef().current.delete(controllerId);
        }
      }).catch((e) => {
        console.error("Failed to listen tmux-controller-exit:", e);
        return null;
      });
      if (cancelled) {
        unlistenTmuxControllerExit?.();
        return;
      }
      if (unlistenTmuxControllerExit) unlisteners.push(unlistenTmuxControllerExit);

      // tmux-pane-added. Idempotent: if a Session with the same
      // xstermSessionId already exists (the bootstrap pane case — added
      // by `create_tmux_session` return value), short-circuit. Otherwise
      // add a new Session to React state. The pane-tree update is owned
      // by `usePaneActions.splitTmuxPane` (which has the user-chosen
      // direction and the workspace/window/pane id context); this
      // listener only ensures the Session exists in React state, even
      // if a race or external source created the pane out-of-band.
      const unlistenTmuxPaneAdded = await subscribeTmuxPaneAdded((event: TmuxPaneAddedEvent) => {
        const { xstermSessionId, controllerId, tmuxPaneId } = event;
        const existing = getSessionsRef().current.find((s) => s.id === xstermSessionId);
        if (existing) {
          // Bootstrap pane: Session was already added by the
          // `create_tmux_session` return value. Nothing to do.
          return;
        }
        const session = buildTmuxPaneSession(
          {
            id: xstermSessionId,
            name: `tmux-${controllerId}:${tmuxPaneId}`,
            tmuxPaneId,
            tmuxControllerId: controllerId,
          },
          { type: "tmux-cc", config: {} },
        );
        useSessionStore.getState().setSessions((prev) => {
          // Re-check inside the setter to avoid a duplicate add if
          // two events race.
          if (prev.some((s) => s.id === xstermSessionId)) return prev;
          return [...prev, session];
        });
      }).catch((e) => {
        console.error("Failed to listen tmux-pane-added:", e);
        return null;
      });
      if (cancelled) {
        unlistenTmuxPaneAdded?.();
        return;
      }
      if (unlistenTmuxPaneAdded) unlisteners.push(unlistenTmuxPaneAdded);

      // tmux-pane-removed. Drop the matching Session from React
      // state and collapse the corresponding leaf in the pane tree.
      // Mirrors the `session-closed` handler.
      const unlistenTmuxPaneRemoved = await subscribeTmuxPaneRemoved(
        (event: TmuxPaneRemovedEvent) => {
          const { xstermSessionId } = event;
          getEstablishingRef().current.delete(xstermSessionId);
          const stillExists = getSessionsRef().current.some((s) => s.id === xstermSessionId);
          if (!stillExists) return;
          useSessionStore
            .getState()
            .setSessions((prev) => prev.filter((s) => s.id !== xstermSessionId));
          useWorkspaceStore.getState().setWorkspaces((prev) =>
            prev.map((workspace) =>
              withRecomputedSessionIds({
                ...workspace,
                windows: workspace.windows.map((window) => {
                  const newRoot = removeSessionAndCollapse(window.rootPane, xstermSessionId);
                  const newActivePaneId = findPaneNode(newRoot, window.activePaneId ?? "")
                    ? window.activePaneId
                    : (getLeafPaneIds(newRoot)[0] ?? null);
                  return { ...window, rootPane: newRoot, activePaneId: newActivePaneId };
                }),
              }),
            ),
          );
        },
      ).catch((e) => {
        console.error("Failed to listen tmux-pane-removed:", e);
        return null;
      });
      if (cancelled) {
        unlistenTmuxPaneRemoved?.();
        return;
      }
      if (unlistenTmuxPaneRemoved) unlisteners.push(unlistenTmuxPaneRemoved);

      // tmux-window-added. Create a new xsterm Window in the
      // active workspace (or first workspace if no active), attach the
      // Session to it, and set it as the active window. Idempotent: if
      // the Session was already inserted by `create_tmux_window`'s
      // return value, the pane-add path is a no-op. If the Session is
      // unknown (race or out-of-band source), we synthesize one.
      //
      // The bootstrap xsterm Window is also installed synchronously by
      // `createAndActivateSession` (Bug fix 2026-09-13), so we dedupe
      // by `xstermWindowId` to avoid inserting a second Window when
      // the bridge fires `tmux-window-added` for the bootstrap pane
      // shortly after the backend return.
      const unlistenTmuxWindowAdded = await subscribeTmuxWindowAdded(
        (event: TmuxWindowAddedEvent) => {
          const { controllerId, tmuxWindowId, xstermWindowId, xstermSessionId, xstermPaneId } =
            event;
          // Bootstrap xsterm Window already inserted by the sync
          // `createAndActivateSession` path — keep the Session
          // mutation logic (below) but skip the Window insert.
          if (
            getWorkspacesRef().current.some((w) =>
              w.windows.some((win) => win.xstermWindowId === xstermWindowId),
            )
          ) {
            if (!getSessionsRef().current.some((s) => s.id === xstermSessionId)) {
              const session = buildTmuxPaneSession(
                {
                  id: xstermSessionId,
                  name: `tmux-${controllerId}:${xstermPaneId}`,
                  tmuxPaneId: xstermPaneId,
                  tmuxControllerId: controllerId,
                },
                { type: "tmux-cc", config: {} },
              );
              session.tmuxWindowId = tmuxWindowId;
              useSessionStore
                .getState()
                .setSessions((prev) =>
                  prev.some((s) => s.id === xstermSessionId) ? prev : [...prev, session],
                );
            } else {
              useSessionStore
                .getState()
                .setSessions((prev) =>
                  prev.map((s) => (s.id === xstermSessionId ? { ...s, tmuxWindowId } : s)),
                );
            }
            return;
          }
          // Make sure the Session exists in React state (idempotent —
          // if `create_tmux_window`'s return value already populated
          // it, this is a no-op).
          if (!getSessionsRef().current.some((s) => s.id === xstermSessionId)) {
            const session = buildTmuxPaneSession(
              {
                id: xstermSessionId,
                name: `tmux-${controllerId}:${xstermPaneId}`,
                tmuxPaneId: xstermPaneId,
                tmuxControllerId: controllerId,
              },
              { type: "tmux-cc", config: {} },
            );
            // also stamp `tmuxWindowId` so the
            // `tmux-window-closed` listener can find this Session when
            // the window is killed.
            session.tmuxWindowId = tmuxWindowId;
            useSessionStore
              .getState()
              .setSessions((prev) =>
                prev.some((s) => s.id === xstermSessionId) ? prev : [...prev, session],
              );
          } else {
            // Session already in state — just stamp the tmuxWindowId
            // so window-close can find it.
            useSessionStore
              .getState()
              .setSessions((prev) =>
                prev.map((s) => (s.id === xstermSessionId ? { ...s, tmuxWindowId } : s)),
              );
          }

          // Pick a target workspace: prefer the one that already
          // has the control-window for this controller (ADR 0009
          // §2.7), then the one with an existing tmux-window for
          // this controller, then the active / first workspace.
          // The control-window lookup is essential: the listener
          // may fire BEFORE `tmux-window-list` lands (so the
          // control-window doesn't exist yet), in which case we
          // fall back to "any workspace that already has a
          // tmux-window for this controller" and finally the
          // active workspace — and insert the control-window
          // lazily when we get there (the next `setWorkspaces`
          // branch below handles that).
          const targetWorkspaceId = (() => {
            const withControlWindow = getWorkspacesRef().current.find((w) =>
              w.windows.some((win) => win.tmuxControlWindowId === controllerId),
            );
            if (withControlWindow) return withControlWindow.id;
            const withController = getWorkspacesRef().current.find((w) =>
              w.windows.some(
                (win) =>
                  win.rootPane.sessionId !== undefined &&
                  getSessionsRef().current.some(
                    (s) => s.id === win.rootPane.sessionId && s.tmuxControllerId === controllerId,
                  ),
              ),
            );
            if (withController) return withController.id;
            const active = getWorkspacesRef().current.find(
              (w) => w.id === getWorkspacesRef().current[0]?.id,
            );
            return active?.id ?? getWorkspacesRef().current[0]?.id ?? null;
          })();
          if (!targetWorkspaceId) return;

          // Resolve the tmux session name for the control-window
          // tab. The Session that just came back carries the
          // same backend controller id, but the front-end
          // `Session.sessionType.config` is intentionally empty
          // (`buildTmuxPaneSession` only fills the discriminator).
          // The original `TmuxCcConfig` lives in
          // `tmuxControllerConfigsRef` keyed by controller id.
          const tmuxSessionName =
            getTmuxConfigsRef().current.get(controllerId)?.tmuxSessionName ??
            `tmux-${controllerId}`;

          // Cheap-and-cheerful rootPane: createLeafPane without
          // pulling it from `model/entities/paneTree` (avoid an
          // import — the legacy listener did the same inline).
          const rootPane = {
            id: crypto.randomUUID(),
            type: "leaf" as const,
            size: 100,
            sessionId: xstermSessionId,
          };
          const windowName = `Window ${xstermPaneId}`;
          useWorkspaceStore.getState().setWorkspaces((prev) =>
            prev.map((workspace) => {
              if (workspace.id !== targetWorkspaceId) return workspace;
              const hasControlWindow = workspace.windows.some(
                (win) => win.tmuxControlWindowId === controllerId,
              );
              // Lazily insert the control-window at the head of the
              // windows[] when this listener fires for a controller
              // whose control-window hasn't been installed yet. This
              // catches the race where tmux-window-added arrives
              // before tmux-window-list (the bridge batch). ADR 0009
              // §2.7 step (4).
              const controlWindow: Window = {
                id: crypto.randomUUID(),
                name: tmuxSessionName,
                rootPane: {
                  id: crypto.randomUUID(),
                  type: "leaf",
                  size: 100,
                },
                activePaneId: null,
                windowType: "tmux-control",
                tmuxControlWindowId: controllerId,
                tmuxControlName: tmuxSessionName,
              };
              const newWindow: Window = {
                id: crypto.randomUUID(),
                name: windowName,
                rootPane,
                activePaneId: rootPane.id,
                windowType: "terminal",
                xstermWindowId,
              };
              const baseWindows = hasControlWindow
                ? workspace.windows
                : [controlWindow, ...workspace.windows];
              return withRecomputedSessionIds({
                ...workspace,
                windows: [...baseWindows, newWindow],
                activeWindowId: newWindow.id,
              });
            }),
          );
        },
      ).catch((e) => {
        console.error("Failed to listen tmux-window-added:", e);
        return null;
      });
      if (cancelled) {
        unlistenTmuxWindowAdded?.();
        return;
      }
      if (unlistenTmuxWindowAdded) unlisteners.push(unlistenTmuxWindowAdded);

      // tmux-window-closed. Drop every Session with the
      // matching `tmuxWindowId`, then drop the matching xsterm Window
      // from its workspace. If the workspace becomes empty, replace
      // it with an init window so the workspace stays usable.
      const unlistenTmuxWindowClosed = await subscribeTmuxWindowClosed(
        (event: TmuxWindowClosedEvent) => {
          const { tmuxWindowId, xstermWindowId } = event;
          // Drop every Session that belonged to this tmux window.
          const deadIds = getSessionsRef()
            .current.filter((s) => s.tmuxWindowId === tmuxWindowId)
            .map((s) => s.id);
          if (deadIds.length > 0) {
            for (const id of deadIds) {
              getEstablishingRef().current.delete(id);
            }
            useSessionStore
              .getState()
              .setSessions((prev) => prev.filter((s) => !deadIds.includes(s.id)));
          }

          // Find the workspace containing the xsterm Window and drop
          // the Window. If the workspace ends up empty, replace with
          // an init window.
          useWorkspaceStore.getState().setWorkspaces((prev) =>
            prev.map((workspace) => {
              const targetWindow = workspace.windows.find(
                (w) => w.xstermWindowId === xstermWindowId,
              );
              // The frontend may not have a Window for this
              // xstermWindowId (e.g. the controller exited before
              // the user-facing Window was created, or this is the
              // bootstrap window which doesn't have xstermWindowId
              // exposed to the frontend). Skip.
              if (!targetWindow) return workspace;
              const remaining = workspace.windows.filter(
                (w) => w.xstermWindowId !== xstermWindowId,
              );
              let nextWindows = remaining;
              let nextActiveId = workspace.activeWindowId;
              if (remaining.length === 0) {
                const initPaneId = crypto.randomUUID();
                const initWindow = {
                  id: crypto.randomUUID(),
                  name: "New Session",
                  activePaneId: initPaneId,
                  windowType: "init" as const,
                  rootPane: {
                    id: initPaneId,
                    type: "leaf" as const,
                    size: 100,
                  },
                };
                nextWindows = [initWindow];
                nextActiveId = initWindow.id;
              } else if (nextActiveId === targetWindow.id) {
                const closedIndex = workspace.windows.findIndex(
                  (w) => w.xstermWindowId === xstermWindowId,
                );
                const fallback =
                  remaining[closedIndex - 1] ??
                  remaining[closedIndex] ??
                  remaining[remaining.length - 1];
                nextActiveId = fallback?.id ?? null;
              }
              return withRecomputedSessionIds({
                ...workspace,
                windows: nextWindows,
                activeWindowId: nextActiveId,
              });
            }),
          );
        },
      ).catch((e) => {
        console.error("Failed to listen tmux-window-closed:", e);
        return null;
      });
      if (cancelled) {
        unlistenTmuxWindowClosed?.();
        return;
      }
      if (unlistenTmuxWindowClosed) unlisteners.push(unlistenTmuxWindowClosed);

      // tmux-window-renamed. Update the matching xsterm Window's
      // `name`. No Session-state mutation is needed — only Window's
      // `name` is rendered in the tab bar.
      const unlistenTmuxWindowRenamed = await subscribeTmuxWindowRenamed(
        (event: TmuxWindowRenamedEvent) => {
          const { xstermWindowId, name } = event;
          useWorkspaceStore.getState().setWorkspaces((prev) =>
            prev.map((workspace) => ({
              ...workspace,
              windows: workspace.windows.map((w) =>
                w.xstermWindowId === xstermWindowId ? { ...w, name } : w,
              ),
            })),
          );
          // Keep the per-controller window-list cache in sync so the
          // windows-control card reflects the rename without waiting
          // for a fresh `tmux-window-list` event.
          for (const [controllerId, entries] of getTmuxWindowsRef().current) {
            const updated = entries.map((e) =>
              e.xstermWindowId === xstermWindowId ? { ...e, name } : e,
            );
            getTmuxWindowsRef().current.set(controllerId, updated);
          }
        },
      ).catch((e) => {
        console.error("Failed to listen tmux-window-renamed:", e);
        return null;
      });
      if (cancelled) {
        unlistenTmuxWindowRenamed?.();
        return;
      }
      if (unlistenTmuxWindowRenamed) unlisteners.push(unlistenTmuxWindowRenamed);

      // tmux-window-list. Bridge module emits this once per
      // controller after the bootstrap `list-windows` reply. The
      // payload contains one row per tmux window on the server, with
      // a freshly-allocated `xsterm_window_id` for each.
      //
      // **This is the authoritative source of truth for attach paths.**
      // The bridge does NOT fire `tmux-window-added` for windows that
      // already existed before the controller attached (Bug 015
      // historical assumption — see dispatch.rs:220 `WindowAdd`
      // case-c) — it only batches them into this single
      // `tmux-window-list` event. So this listener MUST install
      // xsterm Windows for every row to keep local view in sync with
      // the server (Bug 0009 second-order: local window count <
      // server window count on attach).
      //
      // ADR 0009 §2.8 / §2.6: also populate `tmuxWindowListsRef`,
      // which the windows-control card inside the control-window UI
      // reads on first render.
      const unlistenTmuxWindowList = await subscribeTmuxWindowList(
        (controllerId, entries: TmuxWindowListEntry[]) => {
          getTmuxWindowsRef().current.set(controllerId, entries);

          // Sync insert every row as an xsterm Window so the local
          // workspace mirrors the server. The bootstrap window
          // (created by `createAndActivateSession`) is already in
          // workspacesRef.current by the time we get here, so the
          // dedupe check below skips it. All other windows (attach
          // path — server had N windows before this controller
          // connected) get a fresh xsterm Window installed here.
          useWorkspaceStore.getState().setWorkspaces((prev) => {
            // Pick a target workspace: prefer one that already has
            // a control-window for this controller, else the active
            // workspace, else the first.
            const targetId = (() => {
              const withControl = prev.find((w) =>
                w.windows.some((win) => win.tmuxControlWindowId === controllerId),
              );
              if (withControl) return withControl.id;
              const active =
                getWorkspacesRef().current.find(
                  (w) => w.id === getWorkspacesRef().current[0]?.id,
                ) ?? prev[0];
              return active?.id ?? null;
            })();
            if (!targetId) return prev;
            return prev.map((workspace) => {
              if (workspace.id !== targetId) return workspace;
              const existingXstermIds = new Set(
                workspace.windows
                  .map((w) => w.xstermWindowId)
                  .filter((id): id is number => id !== undefined),
              );
              const newWindows: Window[] = [];
              for (const row of entries) {
                const xid = row.xstermWindowId;
                if (xid === undefined || xid === 0) continue;
                if (existingXstermIds.has(xid)) continue;
                // Skip the bootstrap pane's xsterm pane id when
                // xsterm_pane_id is empty (the row represents a
                // window whose first pane we haven't bound yet).
                const rootPane = {
                  id: crypto.randomUUID(),
                  type: "leaf" as const,
                  size: 100,
                  sessionId: row.xstermSessionId ?? 0,
                };
                newWindows.push({
                  id: crypto.randomUUID(),
                  name: row.name,
                  rootPane,
                  activePaneId: rootPane.id,
                  windowType: "terminal",
                  xstermWindowId: xid,
                });
                existingXstermIds.add(xid);
              }
              if (newWindows.length === 0) return workspace;
              return withRecomputedSessionIds({
                ...workspace,
                windows: [...workspace.windows, ...newWindows],
              });
            });
          });
        },
      ).catch((e) => {
        console.error("Failed to listen tmux-window-list:", e);
        return null;
      });
      if (cancelled) {
        unlistenTmuxWindowList?.();
        return;
      }
      if (unlistenTmuxWindowList) unlisteners.push(unlistenTmuxWindowList);
    })();

    return () => {
      cancelled = true;
      unlisteners.forEach((cleanup) => cleanup());
    };
  }, []);
}
