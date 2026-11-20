/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPaneId, createTerminalId, createWindowId, createWorkspaceId } from "../../../models";
import {
  terminalSessionActions,
  type Terminal,
  type TerminalConnectionInfo,
} from "../../../features/terminal";
import type { SavedTerminalConfig } from "../../../features/launch-config";
import { createEditableLeafPane, type Workspace } from "../../../features/workspace";
import { useTerminalReconnectAction } from "./useTerminalReconnectAction";

function createTerminal(id: number): Terminal {
  return {
    id: createTerminalId(id),
    configId: "config-1",
    name: "terminal",
    type: "local",
    isConnected: true,
    kind: { type: "local", shell: "pwsh", cwd: "C:\\" },
    capabilities: {
      supportsResize: true,
      supportsReconnect: true,
      supportsLocalEcho: true,
      supportsMultiplex: false,
    },
  };
}

const savedConfig: SavedTerminalConfig = {
  id: "config-1",
  name: "saved",
  version: 1,
  type: "local",
  config: { shell: "pwsh", cwd: "C:\\" },
};

function createWorkspace(terminalId = createTerminalId(7)): Workspace {
  return {
    id: createWorkspaceId("ws"),
    name: "ws",
    windows: [
      {
        id: createWindowId("win"),
        name: "win",
        rootPane: createEditableLeafPane(createPaneId("pane-1"), 100, terminalId, "config-1"),
        activePaneId: createPaneId("pane-1"),
      },
    ],
    activeWindowId: createWindowId("win"),
    terminalIds: [terminalId],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useTerminalReconnectAction", () => {
  it("reconnects a local session and swaps its id in the pane tree", async () => {
    const oldTerminal = createTerminal(7);
    const info: TerminalConnectionInfo = {
      id: createTerminalId(99),
      name: "reconnected",
      kind: { type: "local", shell: "pwsh", cwd: "C:\\" },
      isConnected: true,
      capabilities: {
        supportsResize: true,
        supportsReconnect: true,
        supportsLocalEcho: true,
        supportsMultiplex: false,
      },
    };
    vi.spyOn(terminalSessionActions, "createLocal").mockResolvedValue(info);
    vi.spyOn(terminalSessionActions, "closeTerminal").mockResolvedValue(undefined);

    let sessions: Terminal[] = [oldTerminal];
    let workspaces: Workspace[] = [createWorkspace()];
    const establishing = new Set([oldTerminal.id]);
    const { result } = renderHook(() =>
      useTerminalReconnectAction({
        savedConfigs: [savedConfig],
        terminalsRef: { current: [oldTerminal] },
        setTerminals: (action) => {
          sessions = typeof action === "function" ? action(sessions) : action;
        },
        setWorkspaces: (action) => {
          workspaces = typeof action === "function" ? action(workspaces) : action;
        },
        establishingTerminalsRef: { current: establishing },
      }),
    );

    const reconnected = await act(() => result.current(oldTerminal.id));

    expect(reconnected.id).toBe(createTerminalId(99));
    expect(terminalSessionActions.createLocal).toHaveBeenCalledWith(savedConfig.config, undefined);
    expect(sessions).toEqual([reconnected]);
    expect(workspaces[0].terminalIds).toEqual([createTerminalId(99)]);
    expect(workspaces[0].windows[0].rootPane.terminalId).toBe(createTerminalId(99));
    expect(establishing.has(oldTerminal.id)).toBe(false);
    expect(terminalSessionActions.closeTerminal).toHaveBeenCalledWith(oldTerminal.id);
  });

  it("rejects when the terminal is unknown", async () => {
    const { result } = renderHook(() =>
      useTerminalReconnectAction({
        savedConfigs: [savedConfig],
        terminalsRef: { current: [] },
        setTerminals: vi.fn(),
        setWorkspaces: vi.fn(),
        establishingTerminalsRef: { current: new Set() },
      }),
    );

    await expect(result.current(createTerminalId(999))).rejects.toMatchObject({
      code: "not-found",
    });
  });

  it("rejects when the terminal's saved config is missing", async () => {
    const oldTerminal = createTerminal(7);
    const { result } = renderHook(() =>
      useTerminalReconnectAction({
        savedConfigs: [],
        terminalsRef: { current: [oldTerminal] },
        setTerminals: vi.fn(),
        setWorkspaces: vi.fn(),
        establishingTerminalsRef: { current: new Set() },
      }),
    );

    await expect(result.current(oldTerminal.id)).rejects.toMatchObject({
      code: "not-found",
    });
  });
});
