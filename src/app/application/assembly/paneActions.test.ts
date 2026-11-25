/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createPaneId, createTerminalId, createWindowId, createWorkspaceId } from "../../../models";
import type { Terminal, TerminalConnectionInfo } from "../../../features/terminal";
import type { Workspace } from "../../../features/workspace";
import { useMultiplexedPaneActions } from "./useMultiplexedPaneActions";
import { usePaneLayoutActions } from "./usePaneLayoutActions";
import { usePaneTreeActions } from "./usePaneTreeActions";

const workspaceId = createWorkspaceId("workspace-1");
const windowId = createWindowId("window-1");
const paneId = createPaneId("pane-1");

function createTerminal(terminalId = 7): Terminal {
  return {
    id: createTerminalId(terminalId),
    configId: `config-${terminalId}`,
    name: `terminal-${terminalId}`,
    type: "local",
    isConnected: true,
    kind: { type: "local", shell: "pwsh", cwd: "C:\\" },
    properties: {},
  };
}

function createWorkspace(terminal?: Terminal): Workspace {
  return {
    id: workspaceId,
    name: "workspace",
    activeWindowId: windowId,
    terminalIds: terminal ? [terminal.id] : [],
    windows: [
      {
        id: windowId,
        name: "window",
        activePaneId: paneId,
        rootPane: {
          id: paneId,
          type: "leaf",
          size: 100,
          ...(terminal ? { terminalId: terminal.id, configId: terminal.configId } : {}),
        },
      },
    ],
  };
}

describe("pane action use cases", () => {
  it("splits a regular pane and activates the new leaf", () => {
    const terminal = createTerminal();
    let workspaces = [createWorkspace(terminal)];
    const { result } = renderHook(() =>
      usePaneLayoutActions({
        terminalsRef: { current: [terminal] },
        workspacesRef: { current: workspaces },
        setWorkspaces: (action) => {
          workspaces = typeof action === "function" ? action(workspaces) : action;
        },
      }),
    );

    act(() => {
      result.current.splitPane(workspaceId, windowId, paneId, "horizontal", terminal.id);
    });

    const root = workspaces[0].windows[0].rootPane;
    expect(root.type).toBe("split");
    expect(workspaces[0].windows[0].activePaneId).not.toBe(paneId);
  });

  it("adds a backend-created multiplexed terminal to state and the pane tree", async () => {
    const parent: Terminal = {
      ...createTerminal(),
      type: "tmux-pane",
      kind: { type: "tmux-pane", sessionId: 3, paneId: "%1" },
      tmux: { controllerId: 3, paneId: "%1" },
    };
    let sessions: Terminal[] = [parent];
    let workspaces = [createWorkspace(parent)];
    const childInfo: TerminalConnectionInfo = {
      id: createTerminalId(8),
      name: "tmux-child",
      kind: { type: "tmux-pane", sessionId: 3, paneId: "%2" },
      isConnected: true,
      capabilities: {
        supportsResize: true,
        supportsReconnect: true,
        supportsLocalEcho: false,
        supportsMultiplex: true,
      },
      tmuxWindowId: "@1",
    };
    const { result } = renderHook(() =>
      useMultiplexedPaneActions({
        terminalsRef: { current: sessions },
        setTerminals: (action) => {
          sessions = typeof action === "function" ? action(sessions) : action;
        },
        setWorkspaces: (action) => {
          workspaces = typeof action === "function" ? action(workspaces) : action;
        },
        createPane: vi.fn(async () => childInfo),
      }),
    );

    await act(() =>
      result.current.splitMultiplexedPane(parent.id, workspaceId, windowId, paneId, "vertical"),
    );

    expect(sessions).toHaveLength(2);
    expect(workspaces[0].windows[0].rootPane.type).toBe("split");
  });

  it("closes the terminal and removes its pane", async () => {
    const terminal = createTerminal();
    let sessions: Terminal[] = [terminal];
    let workspaces = [createWorkspace(terminal)];
    const closeTerminal = vi.fn(async () => undefined);
    const { result } = renderHook(() =>
      usePaneTreeActions({
        workspacesRef: { current: workspaces },
        setTerminals: (action) => {
          sessions = typeof action === "function" ? action(sessions) : action;
        },
        setWorkspaces: (action) => {
          workspaces = typeof action === "function" ? action(workspaces) : action;
        },
        establishingTerminalsRef: { current: new Set([terminal.id]) },
        closeTerminal,
      }),
    );

    await act(() => result.current(workspaceId, windowId, paneId));

    expect(closeTerminal).toHaveBeenCalledWith(terminal.id);
    expect(sessions).toEqual([]);
    expect(workspaces[0].windows[0].rootPane.type).toBe("leaf");
  });
});
