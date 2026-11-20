import { describe, expect, it, vi } from "vitest";
import { createTerminalId } from "../../../models";
import type { TmuxSessionConfig } from "../../../features/launch-config";
import type { Terminal } from "../../../features/terminal";
import type { Workspace } from "../../../features/workspace";
import { createTmuxControllerEventHandlers } from "./tmuxControllerEventHandlers";
import type { TmuxEventBridgePorts, TmuxEventHandlerSet } from "./tmuxEventBridgePorts";
import { buildTmuxPaneSession } from "./tmuxEventTransitions";

type EventOf<HandlerName extends keyof TmuxEventHandlerSet> = Parameters<
  NonNullable<TmuxEventHandlerSet[HandlerName]>
>[0];

const tmuxConfig: TmuxSessionConfig = {
  name: "work",
  ssh: {
    host: "example.com",
    port: 22,
    username: "dev",
    authType: "password",
  },
  tmuxSessionName: "work",
};

function createTerminal(): Terminal {
  return buildTmuxPaneSession({
    id: createTerminalId(7),
    name: "tmux-1:%1",
    tmuxPaneId: "%1",
    tmuxSessionId: 1,
  });
}

function createPorts(terminals: Terminal[]) {
  const state = {
    terminals,
    workspaces: [] as Workspace[],
    controllerErrors: new Map(),
  };
  const syncOpenTmuxSessions = vi.fn();
  const ports: TmuxEventBridgePorts = {
    setTerminals: (action) => {
      state.terminals = typeof action === "function" ? action(state.terminals) : action;
      ports.terminalsRef.current = state.terminals;
    },
    setWorkspaces: (action) => {
      state.workspaces = typeof action === "function" ? action(state.workspaces) : action;
      ports.workspacesRef.current = state.workspaces;
    },
    terminalsRef: { current: terminals },
    workspacesRef: { current: state.workspaces },
    establishingTerminalsRef: { current: new Set() },
    setTmuxControllerErrors: (action) => {
      state.controllerErrors =
        typeof action === "function" ? action(state.controllerErrors) : action;
    },
    tmuxControllerConfigsRef: { current: new Map() },
    tmuxControllerConfigIdsRef: { current: new Map() },
    syncOpenTmuxSessions,
    tmuxControllersClosingRef: { current: new Set() },
  };
  return { ports, state, syncOpenTmuxSessions };
}

describe("tmuxControllerEventHandlers", () => {
  it("merges pane-added metadata into an existing tmux terminal", () => {
    const { ports, state } = createPorts([createTerminal()]);
    const handlers = createTmuxControllerEventHandlers(ports);

    handlers.onPaneAdded?.({
      terminalHandle: 7,
      controllerHandle: 3,
      tmuxPaneId: "%9",
      parentTmuxWindowId: "@4",
      sessionName: "work",
      windowIndex: 2,
      paneIndex: 1,
      width: 120,
      height: 40,
      currentCommand: "vim",
      isActive: true,
      windowName: "editor",
    } as unknown as EventOf<"onPaneAdded">);

    expect(state.terminals).toHaveLength(1);
    expect(state.terminals[0]).toMatchObject({
      id: 7,
      kind: { type: "tmux-pane", sessionId: 3, paneId: "%9" },
      tmux: {
        controllerId: 3,
        paneId: "%9",
        windowId: "@4",
        windowName: "editor",
        command: "vim",
        isActive: true,
      },
    });
  });

  it("does not report an intentional controller close as an error", () => {
    const { ports, syncOpenTmuxSessions } = createPorts([createTerminal()]);
    ports.tmuxControllerConfigsRef.current.set(1, tmuxConfig);
    ports.tmuxControllerConfigIdsRef.current.set(1, "config-1");
    ports.tmuxControllersClosingRef.current.add(1);
    const handlers = createTmuxControllerEventHandlers(ports);

    handlers.onControllerExited?.({
      controllerHandle: 1,
    } as unknown as EventOf<"onControllerExited">);

    expect(ports.tmuxControllersClosingRef.current.has(1)).toBe(false);
    expect(ports.tmuxControllerConfigsRef.current.has(1)).toBe(false);
    expect(ports.tmuxControllerConfigIdsRef.current.has(1)).toBe(false);
    expect(syncOpenTmuxSessions).toHaveBeenCalled();
  });

  it("records an unexpected controller exit for the configured session", () => {
    const { ports, state } = createPorts([createTerminal()]);
    ports.tmuxControllerConfigsRef.current.set(1, tmuxConfig);
    const handlers = createTmuxControllerEventHandlers(ports);

    handlers.onControllerExited?.({
      controllerHandle: 1,
      reason: "connection lost",
    } as unknown as EventOf<"onControllerExited">);

    expect(state.controllerErrors.get(1)).toMatchObject({
      config: tmuxConfig,
      reason: "connection lost",
    });
  });
});
