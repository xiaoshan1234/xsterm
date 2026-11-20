/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createPaneId, createTerminalId, createWindowId, createWorkspaceId } from "../../../models";
import type { Terminal } from "../../../features/terminal";
import type { Window, Workspace } from "../../../features/workspace";
import { useWindowLayoutActions } from "./useWindowLayoutActions";
import { useWindowLifecycleActions } from "./useWindowLifecycleActions";
import { useWindowOpenActions } from "./useWindowOpenActions";

const workspaceId = createWorkspaceId("workspace-1");

function createTerminal(id = 7): Terminal {
  return {
    id: createTerminalId(id),
    configId: `config-${id}`,
    name: `terminal-${id}`,
    type: "local",
    isConnected: true,
    kind: { type: "local", shell: "pwsh", cwd: "C:\\" },
  };
}

function createWindow(id = "window-1", terminalId = 7, xstermWindowId?: number): Window {
  const paneId = createPaneId(`${id}-pane`);
  return {
    id: createWindowId(id),
    name: id,
    activePaneId: paneId,
    rootPane: {
      id: paneId,
      type: "leaf",
      size: 100,
      terminalId: createTerminalId(terminalId),
    },
    ...(xstermWindowId !== undefined ? { xstermWindowId } : {}),
  };
}

function createWorkspace(windows: Window[]): Workspace {
  return {
    id: workspaceId,
    name: "workspace",
    windows,
    activeWindowId: windows[0]?.id ?? null,
    terminalIds: windows.flatMap((window) =>
      window.rootPane.type === "leaf" && window.rootPane.terminalId !== undefined
        ? [window.rootPane.terminalId]
        : [],
    ),
  };
}

describe("window action use cases", () => {
  it("creates a window and marks it active", () => {
    const terminal = createTerminal();
    const workspaces = [createWorkspace([])];
    const setWorkspaces = vi.fn((action) => {
      workspaces[0] =
        typeof action === "function" ? action(workspaces[0] ? workspaces : []) : action;
    });
    const { result } = renderHook(() =>
      useWindowLayoutActions({
        terminalsRef: { current: [terminal] },
        workspacesRef: { current: [createWorkspace([])] },
        setSessions: vi.fn(),
        setWorkspaces: (action) => {
          const current = [createWorkspace([])];
          const next = typeof action === "function" ? action(current) : action;
          setWorkspaces(next);
          workspaces.splice(0, workspaces.length, ...next);
        },
      }),
    );

    act(() => {
      result.current.createWindow(workspaceId, terminal.id);
    });

    expect(setWorkspaces).toHaveBeenCalled();
    expect(workspaces[0].windows).toHaveLength(1);
    expect(workspaces[0].activeWindowId).toBe(workspaces[0].windows[0].id);
  });

  it("closes local terminals and cleans the workspace", () => {
    const terminal = createTerminal();
    const window = createWindow();
    const workspace = createWorkspace([window]);
    const setWorkspaces = vi.fn();
    const setSessions = vi.fn();
    const closeTerminal = vi.fn(async () => undefined);
    const { result } = renderHook(() =>
      useWindowLifecycleActions({
        workspacesRef: { current: [workspace] },
        setSessions,
        setWorkspaces,
        establishingSessionsRef: { current: new Set([terminal.id]) },
        closeTerminal,
        killTmuxWindow: vi.fn(async () => undefined),
        createInitWindow: () => ({
          id: createWindowId("init"),
          name: "New Terminal",
          activePaneId: createPaneId("init-pane"),
          rootPane: { id: createPaneId("init-pane"), type: "leaf", size: 100 },
        }),
      }),
    );

    act(() => result.current(workspaceId, window.id));

    expect(closeTerminal).toHaveBeenCalledWith(terminal.id);
    expect(setSessions).toHaveBeenCalled();
    expect(setWorkspaces).toHaveBeenCalled();
  });

  it("opens a tmux config as an event-driven placeholder window", async () => {
    const terminal: Terminal = {
      ...createTerminal(),
      type: "tmux-pane",
      kind: { type: "tmux-pane", sessionId: 3, paneId: "%1" },
      tmux: { controllerId: 3, paneId: "%1" },
    };
    const createWindowFromSession = vi.fn();
    const { result } = renderHook(() =>
      useWindowOpenActions({
        savedConfigs: [
          {
            id: "tmux-config",
            name: "tmux",
            version: 1,
            type: "tmux-pane",
            config: { tmuxSessionName: "work" },
          },
        ],
        workspacesRef: { current: [] },
        activeWorkspaceId: null,
        createTerminalFromSavedConfig: vi.fn(async () => terminal),
        createWindowFromSession,
      }),
    );

    const window = await act(() => result.current("tmux-config"));

    expect(window.windowType).toBe("terminal");
    expect(window.rootPane).toMatchObject({ terminalId: terminal.id });
    expect(createWindowFromSession).not.toHaveBeenCalled();
  });
});
