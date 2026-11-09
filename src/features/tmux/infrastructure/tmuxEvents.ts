import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { toBackendTerminalHandle } from "../../terminal/infrastructure/handles";
import { toBackendControllerHandle, toBackendWindowHandle } from "./handles";
import {
  type TmuxControllerExitedEvent,
  type TmuxPaneAddedEvent,
  type TmuxPanePausedEvent,
  type TmuxPaneRemovedEvent,
  type TmuxWindowAddedEvent,
  type TmuxWindowClosedEvent,
  type TmuxWindowRenamedEvent,
} from "./tauriContracts";

type ListenFunction = <Payload>(
  eventName: string,
  handler: (payload: Payload) => void,
) => Promise<UnlistenFn>;

export interface TmuxEventHandlers {
  onControllerExited?: (event: TmuxControllerExitedEvent) => void;
  onPaneAdded?: (event: TmuxPaneAddedEvent) => void;
  onPaneRemoved?: (event: TmuxPaneRemovedEvent) => void;
  onPanePaused?: (event: TmuxPanePausedEvent) => void;
  onPaneContinued?: (event: TmuxPanePausedEvent) => void;
  onWindowAdded?: (event: TmuxWindowAddedEvent) => void;
  onWindowClosed?: (event: TmuxWindowClosedEvent) => void;
  onWindowRenamed?: (event: TmuxWindowRenamedEvent) => void;
}

interface RawTmuxControllerExited {
  controller_id: number;
  reason?: string;
}

interface RawTmuxPaneMetadata {
  window_index: number;
  pane_index: number;
  width: number;
  height: number;
  x: number;
  y: number;
  current_command?: string;
  is_active?: boolean;
  window_name?: string;
}

interface RawTmuxPaneAdded extends RawTmuxPaneMetadata {
  controller_id: number;
  tmux_pane_id: string;
  xsterm_session_id: number;
  parent_tmux_window_id: string;
  session_name?: string;
}

interface RawTmuxPaneRemoved {
  controller_id: number;
  tmux_pane_id: string;
  xsterm_session_id: number;
}

interface RawTmuxWindowAdded {
  controller_id: number;
  tmux_window_id: string;
  xsterm_window_id: number;
  name: string;
  session_name?: string;
  panes: Array<
    RawTmuxPaneMetadata & {
      tmux_pane_id: string;
      xsterm_session_id: number;
    }
  >;
  layout?: string;
}

interface RawTmuxWindowClosed {
  controller_id: number;
  tmux_window_id: string;
  xsterm_window_id: number;
}

interface RawTmuxWindowRenamed extends RawTmuxWindowClosed {
  name: string;
}

interface RawTmuxPanePaused {
  tmux_pane_id: string;
}

export async function subscribeTmuxEvents(
  handlers: TmuxEventHandlers,
  listenFunction: ListenFunction = defaultListen,
): Promise<UnlistenFn> {
  const subscriptions: Array<Promise<UnlistenFn>> = [];

  addSubscription(
    subscriptions,
    handlers.onControllerExited,
    "tmux-controller-exit",
    listenFunction,
    normalizeControllerExited,
  );
  addSubscription(
    subscriptions,
    handlers.onPaneAdded,
    "tmux-pane-added",
    listenFunction,
    normalizePaneAdded,
  );
  addSubscription(
    subscriptions,
    handlers.onPaneRemoved,
    "tmux-pane-removed",
    listenFunction,
    normalizePaneRemoved,
  );
  addSubscription(
    subscriptions,
    handlers.onPanePaused,
    "tmux-paused",
    listenFunction,
    normalizePanePaused,
  );
  addSubscription(
    subscriptions,
    handlers.onPaneContinued,
    "tmux-continued",
    listenFunction,
    normalizePanePaused,
  );
  addSubscription(
    subscriptions,
    handlers.onWindowAdded,
    "tmux-window-added",
    listenFunction,
    normalizeWindowAdded,
  );
  addSubscription(
    subscriptions,
    handlers.onWindowClosed,
    "tmux-window-closed",
    listenFunction,
    normalizeWindowClosed,
  );
  addSubscription(
    subscriptions,
    handlers.onWindowRenamed,
    "tmux-window-renamed",
    listenFunction,
    normalizeWindowRenamed,
  );

  try {
    const unlisteners = await Promise.all(subscriptions);
    return () => {
      for (const unlisten of unlisteners) unlisten();
    };
  } catch (error) {
    const settled = await Promise.allSettled(subscriptions);
    for (const result of settled) {
      if (result.status === "fulfilled") result.value();
    }
    throw error;
  }
}

export function normalizeControllerExited(
  payload: RawTmuxControllerExited,
): TmuxControllerExitedEvent {
  return {
    controllerHandle: toBackendControllerHandle(payload.controller_id),
    ...(payload.reason ? { reason: payload.reason } : {}),
  };
}

export function normalizePaneAdded(payload: RawTmuxPaneAdded): TmuxPaneAddedEvent {
  return {
    controllerHandle: toBackendControllerHandle(payload.controller_id),
    terminalHandle: toBackendTerminalHandle(payload.xsterm_session_id),
    tmuxPaneId: payload.tmux_pane_id,
    parentTmuxWindowId: payload.parent_tmux_window_id,
    ...(payload.session_name ? { sessionName: payload.session_name } : {}),
    windowIndex: payload.window_index,
    paneIndex: payload.pane_index,
    width: payload.width,
    height: payload.height,
    x: payload.x,
    y: payload.y,
    ...(payload.current_command ? { currentCommand: payload.current_command } : {}),
    ...(payload.is_active !== undefined ? { isActive: payload.is_active } : {}),
    ...(payload.window_name ? { windowName: payload.window_name } : {}),
  };
}

export function normalizePaneRemoved(payload: RawTmuxPaneRemoved): TmuxPaneRemovedEvent {
  return {
    controllerHandle: toBackendControllerHandle(payload.controller_id),
    terminalHandle: toBackendTerminalHandle(payload.xsterm_session_id),
    tmuxPaneId: payload.tmux_pane_id,
  };
}

export function normalizePanePaused(payload: RawTmuxPanePaused): TmuxPanePausedEvent {
  return {
    tmuxPaneId: payload.tmux_pane_id,
  };
}

export function normalizeWindowAdded(payload: RawTmuxWindowAdded): TmuxWindowAddedEvent {
  return {
    controllerHandle: toBackendControllerHandle(payload.controller_id),
    tmuxWindowId: payload.tmux_window_id,
    backendWindowHandle: toBackendWindowHandle(payload.xsterm_window_id),
    name: payload.name,
    ...(payload.session_name ? { sessionName: payload.session_name } : {}),
    panes: (payload.panes ?? []).map((pane) => ({
      terminalHandle: toBackendTerminalHandle(pane.xsterm_session_id),
      tmuxPaneId: pane.tmux_pane_id,
      windowIndex: pane.window_index,
      paneIndex: pane.pane_index,
      width: pane.width,
      height: pane.height,
      x: pane.x,
      y: pane.y,
      ...(pane.current_command ? { currentCommand: pane.current_command } : {}),
      ...(pane.is_active !== undefined ? { isActive: pane.is_active } : {}),
      ...(pane.window_name ? { windowName: pane.window_name } : {}),
    })),
    layout: payload.layout ?? "",
  };
}

export function normalizeWindowClosed(payload: RawTmuxWindowClosed): TmuxWindowClosedEvent {
  return {
    controllerHandle: toBackendControllerHandle(payload.controller_id),
    tmuxWindowId: payload.tmux_window_id,
    backendWindowHandle: toBackendWindowHandle(payload.xsterm_window_id),
  };
}

export function normalizeWindowRenamed(payload: RawTmuxWindowRenamed): TmuxWindowRenamedEvent {
  return {
    controllerHandle: toBackendControllerHandle(payload.controller_id),
    tmuxWindowId: payload.tmux_window_id,
    backendWindowHandle: toBackendWindowHandle(payload.xsterm_window_id),
    name: payload.name,
  };
}

function addSubscription<Payload, Event>(
  subscriptions: Array<Promise<UnlistenFn>>,
  handler: ((event: Event) => void) | undefined,
  eventName: string,
  listenFunction: ListenFunction,
  normalize: (payload: Payload) => Event,
): void {
  if (!handler) return;
  subscriptions.push(
    listenFunction<Payload>(eventName, (payload) => {
      handler(normalize(payload));
    }),
  );
}

async function defaultListen<Payload>(
  eventName: string,
  handler: (payload: Payload) => void,
): Promise<UnlistenFn> {
  return listen<Payload>(eventName, (event) => handler(event.payload));
}
