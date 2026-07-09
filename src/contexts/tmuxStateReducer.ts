import { TmuxState, TmuxStateSnapshot, TmuxPane, TmuxWindow, TmuxSessionState } from "../types/tmux";

/**
 * Create a shallow copy of the tmux state tree.
 *
 * Maps are copied by reference (not deep-cloned) because each event handler
 * replaces the entries it touches, leaving untouched branches shared.
 */
export function cloneTmuxState(state: TmuxState): TmuxState {
  return {
    sessions: new Map(state.sessions),
    windows: new Map(state.windows),
    panes: new Map(state.panes),
    underlays: new Map(state.underlays),
  };
}

/**
 * Apply a tmux state snapshot to the frontend state tree.
 *
 * The snapshot is merged into the existing state. Any windows or panes that
 * belong to the underlay session but are not present in the snapshot are
 * removed. The session is keyed by the frontend xsterm session id.
 */
export function applyTmuxStateSync(
  state: TmuxState,
  sessionId: number,
  snapshot: TmuxStateSnapshot
): TmuxState {
  const next = cloneTmuxState(state);
  const sessionIdKey = String(sessionId);

  const snapshotWindowIds = new Set<string>();
  const snapshotPaneIds = new Set<string>();

  for (const session of Object.values(snapshot.sessions)) {
    const existing = next.sessions.get(sessionIdKey);
    const mergedSession: TmuxSessionState = {
      id: sessionIdKey,
      tmuxSessionId: session.id,
      name: session.name,
      windows: existing?.windows ?? [],
      activeWindowId: existing?.activeWindowId,
    };
    next.sessions.set(sessionIdKey, mergedSession);
  }

  for (const window of Object.values(snapshot.windows)) {
    snapshotWindowIds.add(window.id);
    const existing = next.windows.get(window.id);
    const mergedWindow: TmuxWindow = {
      id: window.id,
      sessionId: sessionIdKey,
      name: window.name,
      layout: window.layout,
      panes: existing?.panes ?? [],
      isActive: window.active,
      activePaneId: existing?.activePaneId,
    };
    next.windows.set(window.id, mergedWindow);

    const session = next.sessions.get(sessionIdKey);
    if (session && !session.windows.includes(window.id)) {
      next.sessions.set(sessionIdKey, {
        ...session,
        windows: [...session.windows, window.id],
      });
    }
    if (window.active) {
      const updatedSession = next.sessions.get(sessionIdKey);
      if (updatedSession) {
        next.sessions.set(sessionIdKey, {
          ...updatedSession,
          activeWindowId: window.id,
        });
      }
    }
  }

  for (const pane of Object.values(snapshot.panes)) {
    snapshotPaneIds.add(pane.id);
    const mergedPane: TmuxPane = {
      id: pane.id,
      sessionId: sessionIdKey,
      windowId: pane.windowId,
      title: pane.title,
      isActive: pane.active,
      isPaused: next.panes.get(pane.id)?.isPaused ?? false,
      inCopyMode: next.panes.get(pane.id)?.inCopyMode ?? false,
      width: pane.width,
      height: pane.height,
    };
    next.panes.set(pane.id, mergedPane);

    const window = next.windows.get(pane.windowId);
    if (window && !window.panes.includes(pane.id)) {
      next.windows.set(pane.windowId, {
        ...window,
        panes: [...window.panes, pane.id],
      });
    }
    if (pane.active) {
      const updatedWindow = next.windows.get(pane.windowId);
      if (updatedWindow) {
        next.windows.set(pane.windowId, {
          ...updatedWindow,
          activePaneId: pane.id,
        });
      }
    }
  }

  // Remove stale windows and panes for this underlay session.
  for (const [wid, window] of next.windows) {
    if (window.sessionId === sessionIdKey && !snapshotWindowIds.has(wid)) {
      next.windows.delete(wid);
      const session = next.sessions.get(sessionIdKey);
      if (session) {
        const remainingWindows = session.windows.filter((id) => id !== wid);
        const activeWindowId =
          session.activeWindowId === wid ? remainingWindows[0] : session.activeWindowId;
        next.sessions.set(sessionIdKey, {
          ...session,
          windows: remainingWindows,
          activeWindowId,
        });
      }
    }
  }

  for (const [pid, pane] of next.panes) {
    if (pane.sessionId === sessionIdKey && !snapshotPaneIds.has(pid)) {
      next.panes.delete(pid);
      const window = next.windows.get(pane.windowId);
      if (window) {
        next.windows.set(pane.windowId, {
          ...window,
          panes: window.panes.filter((id) => id !== pid),
        });
      }
    }
  }

  // Update underlay status to connected.
  const underlay = next.underlays.get(sessionId);
  if (underlay) {
    next.underlays.set(sessionId, { ...underlay, status: "connected", error: undefined });
  }

  return next;
}
