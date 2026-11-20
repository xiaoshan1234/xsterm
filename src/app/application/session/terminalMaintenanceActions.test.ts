/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTerminalId } from "../../../models";
import { terminalSessionActions, type Terminal } from "../../../features/terminal";
import { useTerminalCloseAction } from "./useTerminalCloseAction";
import { useTerminalMetadataActions } from "./useTerminalMetadataActions";
import { useTerminalReconnectAction } from "./useTerminalReconnectAction";

function createTerminal(): Terminal {
  return {
    id: createTerminalId(7),
    configId: "config-1",
    name: "Terminal",
    type: "local",
    isConnected: true,
    kind: { type: "local", shell: "pwsh", cwd: "C:\\" },
    capabilities: {
      supportsResize: true,
      supportsReconnect: false,
      supportsLocalEcho: true,
      supportsMultiplex: false,
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("terminal maintenance actions", () => {
  it("closes a terminal and removes it from session state", async () => {
    let sessions: Terminal[] = [createTerminal()];
    vi.spyOn(terminalSessionActions, "closeTerminal").mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useTerminalCloseAction({
        setSessions: (action) => {
          sessions = typeof action === "function" ? action(sessions) : action;
        },
        setWorkspaces: vi.fn(),
      }),
    );

    await act(() => result.current(createTerminalId(7)));

    expect(sessions).toEqual([]);
    expect(terminalSessionActions.closeTerminal).toHaveBeenCalledWith(createTerminalId(7));
  });

  it("renames a live session and its saved config", () => {
    const terminal = createTerminal();
    let sessions = [terminal];
    const updateConfigs = vi.fn();
    const { result } = renderHook(() =>
      useTerminalMetadataActions({
        terminalsRef: { current: [terminal] },
        setSessions: (action) => {
          sessions = typeof action === "function" ? action(sessions) : action;
        },
        updateConfigs,
      }),
    );

    act(() => result.current.renameSession(terminal.id, "renamed"));

    expect(sessions[0].name).toBe("renamed");
    expect(updateConfigs).toHaveBeenCalled();
  });

  it("rejects reconnect when the transport does not support it", async () => {
    const terminal = createTerminal();
    const { result } = renderHook(() =>
      useTerminalReconnectAction({
        savedConfigs: [],
        terminalsRef: { current: [terminal] },
        setSessions: vi.fn(),
        setWorkspaces: vi.fn(),
        establishingSessionsRef: { current: new Set() },
      }),
    );

    await expect(result.current(terminal.id)).rejects.toMatchObject({
      code: "unsupported-operation",
    });
  });
});
