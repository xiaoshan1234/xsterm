import { TmuxState, TmuxControlEvent, TmuxWindow, TmuxPane } from "../types/session";
import * as tmuxService from "../services/tmuxService";

export function cloneTmuxState(state: TmuxState): TmuxState {
  return {
    sessions: new Map(state.sessions),
    windows: new Map(state.windows),
    panes: new Map(state.panes),
  };
}

export function applyTmuxControlEvent(
  state: TmuxState,
  _sessionId: string,
  event: TmuxControlEvent
): TmuxState {
  const next = cloneTmuxState(state);

  switch (event.type) {
    case "SessionChanged": {
      let session = next.sessions.get(_sessionId);
      if (!session) {
        session = {
          id: _sessionId,
          tmuxSessionId: event.sessionId,
          name: event.name,
          windows: [],
        };
        next.sessions.set(_sessionId, session);
      }
      session.name = event.name;
      session.tmuxSessionId = event.sessionId;
      break;
    }
    case "SessionRenamed": {
      const session = next.sessions.get(_sessionId);
      if (session) session.name = event.name;
      break;
    }
    case "WindowAdded": {
      const window: TmuxWindow = {
        ...event.window,
        sessionId: _sessionId,
        panes: [...event.window.panes],
      };
      next.windows.set(window.id, window);
      const session = next.sessions.get(_sessionId);
      if (session && !session.windows.includes(window.id)) {
        session.windows.push(window.id);
      }
      if (!session) {
        // The window arrived before its session metadata; request a refresh.
        tmuxService
          .writeTmuxCommand(
            Number.parseInt(_sessionId, 10) || 0,
            `list-sessions\n`
          )
          .catch(console.error);
      }
      break;
    }
    case "WindowClosed": {
      const window = next.windows.get(event.windowId);
      if (window) {
        next.windows.delete(event.windowId);
        const session = next.sessions.get(window.sessionId);
        if (session) {
          session.windows = session.windows.filter((id) => id !== event.windowId);
        }
        for (const paneId of window.panes) {
          next.panes.delete(paneId);
        }
      }
      break;
    }
    case "WindowRenamed": {
      const window = next.windows.get(event.windowId);
      if (window) window.name = event.name;
      break;
    }
    case "WindowActivated": {
      const window = next.windows.get(event.windowId);
      if (window) {
        for (const [wid, w] of next.windows) {
          if (w.sessionId === window.sessionId) {
            w.isActive = wid === window.id;
          }
        }
        const session = next.sessions.get(window.sessionId);
        if (session) session.activeWindowId = window.id;
      }
      break;
    }
    case "LayoutChanged": {
      const window = next.windows.get(event.windowId);
      if (window) window.layout = event.layout;
      break;
    }
    case "PaneAdded": {
      const pane: TmuxPane = { ...event.pane, sessionId: _sessionId };
      next.panes.set(pane.id, pane);
      const window = next.windows.get(pane.windowId);
      if (window && !window.panes.includes(pane.id)) {
        window.panes.push(pane.id);
      }
      break;
    }
    case "PaneClosed": {
      const pane = next.panes.get(event.paneId);
      if (pane) {
        next.panes.delete(event.paneId);
        const window = next.windows.get(pane.windowId);
        if (window) {
          window.panes = window.panes.filter((id) => id !== event.paneId);
        }
      }
      break;
    }
    case "PaneTitleChanged": {
      const pane = next.panes.get(event.paneId);
      if (pane) pane.title = event.title;
      break;
    }
    case "PaneModeChanged": {
      const pane = next.panes.get(event.paneId);
      if (pane) pane.inCopyMode = event.inCopyMode;
      break;
    }
    case "PanePaused": {
      const pane = next.panes.get(event.paneId);
      if (pane) pane.isPaused = true;
      break;
    }
    case "PaneContinued": {
      const pane = next.panes.get(event.paneId);
      if (pane) pane.isPaused = false;
      break;
    }
    case "WindowList": {
      for (const entry of event.windows) {
        let session = next.sessions.get(_sessionId);
        if (!session) {
          session = {
            id: _sessionId,
            tmuxSessionId: entry.sessionId,
            name: "",
            windows: [],
          };
          next.sessions.set(_sessionId, session);
        }
        if (!session.windows.includes(entry.windowId)) {
          session.windows.push(entry.windowId);
        }

        const existing = next.windows.get(entry.windowId);
        next.windows.set(entry.windowId, {
          id: entry.windowId,
          sessionId: _sessionId,
          name: entry.name,
          layout: entry.layout,
          panes: existing?.panes ?? [],
          isActive: entry.active,
        });

        if (entry.active) {
          session.activeWindowId = entry.windowId;
        }
      }

      setTimeout(() => {
        for (const entry of event.windows) {
          tmuxService
            .listPanes(Number.parseInt(_sessionId, 10) || 0, entry.windowId)
            .catch(console.error);
        }
      }, 0);
      break;
    }
    case "PaneList": {
      for (const entry of event.panes) {
        let session = next.sessions.get(_sessionId);
        if (!session) {
          session = {
            id: _sessionId,
            tmuxSessionId: entry.sessionId,
            name: "",
            windows: [],
          };
          next.sessions.set(_sessionId, session);
        }
        let window = next.windows.get(entry.windowId);
        if (!window) {
          window = {
            id: entry.windowId,
            sessionId: _sessionId,
            name: "",
            layout: "",
            panes: [],
            isActive: false,
          };
          next.windows.set(entry.windowId, window);
          if (!session.windows.includes(entry.windowId)) {
            session.windows.push(entry.windowId);
          }
        }
        if (!window.panes.includes(entry.paneId)) {
          window.panes.push(entry.paneId);
        }
        next.panes.set(entry.paneId, {
          id: entry.paneId,
          sessionId: _sessionId,
          windowId: entry.windowId,
          title: entry.title,
          isActive: entry.active,
          isPaused: next.panes.get(entry.paneId)?.isPaused ?? false,
          inCopyMode: next.panes.get(entry.paneId)?.inCopyMode ?? false,
          width: entry.width,
          height: entry.height,
        });
      }
      break;
    }
    case "CommandError": {
      console.error(`tmux command ${event.cmdNum} failed: ${event.message}`);
      break;
    }
    case "Exit": {
      // Session closure is handled by the session-closed event.
      break;
    }
    case "Unknown": {
      break;
    }
  }

  return next;
}
