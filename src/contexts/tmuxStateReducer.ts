import { TmuxState, TmuxControlEvent, TmuxWindow, TmuxPane } from "../types/tmux";
import * as tmuxService from "../services/tmuxService";

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
  };
}

/**
 * Apply a single tmux control-mode event to the frontend state tree.
 *
 * Conventions used by the reducer:
 * - `sessionId` is the frontend xsterm session id (a number rendered as a
 *   string), not the tmux `$N` session id.
 * - Events may arrive before their parent session/window metadata, so handlers
 *   lazily create placeholder parents and request a server-side refresh.
 * - Each handler updates the `next` state produced by `cloneTmuxState` by
 *   replacing the session/window/pane objects it touches; the dispatcher
 *   returns the updated tree to React.
 */
export function applyTmuxControlEvent(
  state: TmuxState,
  sessionId: string,
  event: TmuxControlEvent
): TmuxState {
  const next = cloneTmuxState(state);

  switch (event.type) {
    case "SessionChanged":
      handleSessionChanged(next, sessionId, event);
      break;
    case "SessionRenamed":
      handleSessionRenamed(next, sessionId, event);
      break;
    case "WindowAdded":
      handleWindowAdded(next, sessionId, event);
      break;
    case "WindowClosed":
      handleWindowClosed(next, event);
      break;
    case "WindowRenamed":
      handleWindowRenamed(next, event);
      break;
    case "WindowActivated":
      handleWindowActivated(next, event);
      break;
    case "LayoutChanged":
      handleLayoutChanged(next, event);
      break;
    case "PaneAdded":
      handlePaneAdded(next, sessionId, event);
      break;
    case "PaneClosed":
      handlePaneClosed(next, event);
      break;
    case "PaneTitleChanged":
      handlePaneTitleChanged(next, event);
      break;
    case "PaneModeChanged":
      handlePaneModeChanged(next, event);
      break;
    case "PanePaused":
      handlePanePaused(next, event);
      break;
    case "PaneContinued":
      handlePaneContinued(next, event);
      break;
    case "WindowList":
      handleWindowList(next, sessionId, event);
      break;
    case "PaneList":
      handlePaneList(next, sessionId, event);
      break;
    case "CommandError":
      handleCommandError(event);
      break;
    case "Exit":
      // Session closure is handled by the session-closed event.
      break;
    case "Unknown":
      break;
  }

  return next;
}

/* -------------------------------------------------------------------------- */
/* Session events                                                             */
/* -------------------------------------------------------------------------- */

function handleSessionChanged(
  next: TmuxState,
  sessionId: string,
  event: Extract<TmuxControlEvent, { type: "SessionChanged" }>
) {
  const session = next.sessions.get(sessionId);
  if (!session) {
    next.sessions.set(sessionId, {
      id: sessionId,
      tmuxSessionId: event.sessionId,
      name: event.name,
      windows: [],
    });
    return;
  }
  next.sessions.set(sessionId, {
    ...session,
    name: event.name,
    tmuxSessionId: event.sessionId,
  });
}

function handleSessionRenamed(
  next: TmuxState,
  sessionId: string,
  event: Extract<TmuxControlEvent, { type: "SessionRenamed" }>
) {
  const session = next.sessions.get(sessionId);
  if (!session) return;
  next.sessions.set(sessionId, { ...session, name: event.name });
}

/* -------------------------------------------------------------------------- */
/* Window events                                                              */
/* -------------------------------------------------------------------------- */

function handleWindowAdded(
  next: TmuxState,
  sessionId: string,
  event: Extract<TmuxControlEvent, { type: "WindowAdded" }>
) {
  const window: TmuxWindow = {
    ...event.window,
    sessionId,
    panes: [...event.window.panes],
  };
  next.windows.set(window.id, window);

  const session = next.sessions.get(sessionId);
  if (session && !session.windows.includes(window.id)) {
    next.sessions.set(sessionId, {
      ...session,
      windows: [...session.windows, window.id],
    });
  }

  if (!session) {
    // The window arrived before its session metadata; request a refresh.
    tmuxService
      .writeTmuxCommand(Number.parseInt(sessionId, 10) || 0, `list-sessions\n`)
      .catch(() => {});
  }

  tmuxService
    .listPanes(Number.parseInt(sessionId, 10) || 0, window.id)
    .catch(() => {});
}

function handleWindowClosed(
  next: TmuxState,
  event: Extract<TmuxControlEvent, { type: "WindowClosed" }>
) {
  const window = next.windows.get(event.windowId);
  if (!window) return;

  next.windows.delete(event.windowId);

  const session = next.sessions.get(window.sessionId);
  if (session) {
    const remainingWindows = session.windows.filter((id) => id !== event.windowId);
    const activeWindowId =
      session.activeWindowId === event.windowId
        ? remainingWindows[0]
        : session.activeWindowId;

    next.sessions.set(window.sessionId, {
      ...session,
      windows: remainingWindows,
      activeWindowId,
    });

    for (const [wid, w] of next.windows) {
      if (w.sessionId === window.sessionId) {
        next.windows.set(wid, {
          ...w,
          isActive: wid === activeWindowId,
        });
      }
    }
  }

  for (const paneId of window.panes) {
    next.panes.delete(paneId);
  }
}

function handleWindowRenamed(
  next: TmuxState,
  event: Extract<TmuxControlEvent, { type: "WindowRenamed" }>
) {
  const window = next.windows.get(event.windowId);
  if (!window) return;
  next.windows.set(event.windowId, { ...window, name: event.name });
}

function handleWindowActivated(
  next: TmuxState,
  event: Extract<TmuxControlEvent, { type: "WindowActivated" }>
) {
  const window = next.windows.get(event.windowId);
  if (!window) return;

  for (const [wid, w] of next.windows) {
    if (w.sessionId === window.sessionId) {
      next.windows.set(wid, { ...w, isActive: wid === window.id });
    }
  }

  const session = next.sessions.get(window.sessionId);
  if (session) {
    next.sessions.set(window.sessionId, {
      ...session,
      activeWindowId: window.id,
    });
  }
}

function handleLayoutChanged(
  next: TmuxState,
  event: Extract<TmuxControlEvent, { type: "LayoutChanged" }>
) {
  const window = next.windows.get(event.windowId);
  if (!window) return;
  next.windows.set(event.windowId, { ...window, layout: event.layout });
}

/* -------------------------------------------------------------------------- */
/* Pane events                                                                */
/* -------------------------------------------------------------------------- */

function handlePaneAdded(
  next: TmuxState,
  sessionId: string,
  event: Extract<TmuxControlEvent, { type: "PaneAdded" }>
) {
  const pane: TmuxPane = { ...event.pane, sessionId };
  next.panes.set(pane.id, pane);

  const window = next.windows.get(pane.windowId);
  if (window && !window.panes.includes(pane.id)) {
    next.windows.set(pane.windowId, {
      ...window,
      panes: [...window.panes, pane.id],
    });
  }
}

function handlePaneClosed(
  next: TmuxState,
  event: Extract<TmuxControlEvent, { type: "PaneClosed" }>
) {
  const pane = next.panes.get(event.paneId);
  if (!pane) return;

  next.panes.delete(event.paneId);

  const window = next.windows.get(pane.windowId);
  if (window) {
    next.windows.set(pane.windowId, {
      ...window,
      panes: window.panes.filter((id) => id !== event.paneId),
    });
  }
}

function handlePaneTitleChanged(
  next: TmuxState,
  event: Extract<TmuxControlEvent, { type: "PaneTitleChanged" }>
) {
  const pane = next.panes.get(event.paneId);
  if (!pane) return;
  next.panes.set(event.paneId, { ...pane, title: event.title });
}

function handlePaneModeChanged(
  next: TmuxState,
  event: Extract<TmuxControlEvent, { type: "PaneModeChanged" }>
) {
  const pane = next.panes.get(event.paneId);
  if (!pane) return;
  next.panes.set(event.paneId, { ...pane, inCopyMode: event.inCopyMode });
}

function handlePanePaused(
  next: TmuxState,
  event: Extract<TmuxControlEvent, { type: "PanePaused" }>
) {
  const pane = next.panes.get(event.paneId);
  if (!pane) return;
  next.panes.set(event.paneId, { ...pane, isPaused: true });
}

function handlePaneContinued(
  next: TmuxState,
  event: Extract<TmuxControlEvent, { type: "PaneContinued" }>
) {
  const pane = next.panes.get(event.paneId);
  if (!pane) return;
  next.panes.set(event.paneId, { ...pane, isPaused: false });
}

/* -------------------------------------------------------------------------- */
/* Bulk sync events                                                           */
/* -------------------------------------------------------------------------- */

function handleWindowList(
  next: TmuxState,
  sessionId: string,
  event: Extract<TmuxControlEvent, { type: "WindowList" }>
) {
  for (const entry of event.windows) {
    let session = next.sessions.get(sessionId);
    if (!session) {
      session = {
        id: sessionId,
        tmuxSessionId: entry.sessionId,
        name: "",
        windows: [],
      };
      next.sessions.set(sessionId, session);
    }
    if (!session.windows.includes(entry.windowId)) {
      next.sessions.set(sessionId, {
        ...session,
        windows: [...session.windows, entry.windowId],
      });
    }

    const existing = next.windows.get(entry.windowId);
    next.windows.set(entry.windowId, {
      id: entry.windowId,
      sessionId,
      name: entry.name,
      layout: entry.layout,
      panes: existing?.panes ?? [],
      isActive: entry.active,
    });

    if (entry.active) {
      const updatedSession = next.sessions.get(sessionId);
      if (updatedSession) {
        next.sessions.set(sessionId, {
          ...updatedSession,
          activeWindowId: entry.windowId,
        });
      }
    }
  }

  setTimeout(() => {
    for (const entry of event.windows) {
      tmuxService
        .listPanes(Number.parseInt(sessionId, 10) || 0, entry.windowId)
        .catch(() => {});
    }
  }, 0);
}

function handlePaneList(
  next: TmuxState,
  sessionId: string,
  event: Extract<TmuxControlEvent, { type: "PaneList" }>
) {
  for (const entry of event.panes) {
    let session = next.sessions.get(sessionId);
    if (!session) {
      session = {
        id: sessionId,
        tmuxSessionId: entry.sessionId,
        name: "",
        windows: [],
      };
      next.sessions.set(sessionId, session);
    }

    let window = next.windows.get(entry.windowId);
    if (!window) {
      window = {
        id: entry.windowId,
        sessionId,
        name: "",
        layout: "",
        panes: [],
        isActive: false,
      };
      next.windows.set(entry.windowId, window);
      if (!session.windows.includes(entry.windowId)) {
        next.sessions.set(sessionId, {
          ...session,
          windows: [...session.windows, entry.windowId],
        });
      }
    }

    if (!window.panes.includes(entry.paneId)) {
      next.windows.set(entry.windowId, {
        ...window,
        panes: [...window.panes, entry.paneId],
      });
    }

    const existingPane = next.panes.get(entry.paneId);
    next.panes.set(entry.paneId, {
      id: entry.paneId,
      sessionId,
      windowId: entry.windowId,
      title: entry.title,
      isActive: entry.active,
      isPaused: existingPane?.isPaused ?? false,
      inCopyMode: existingPane?.inCopyMode ?? false,
      width: entry.width,
      height: entry.height,
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Error / lifecycle events                                                   */
/* -------------------------------------------------------------------------- */

function handleCommandError(event: Extract<TmuxControlEvent, { type: "CommandError" }>) {
  console.error(`tmux command ${event.cmdNum} failed: ${event.message}`);
}
