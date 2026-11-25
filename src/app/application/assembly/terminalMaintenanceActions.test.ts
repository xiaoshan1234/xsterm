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
    properties: {},
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
        setTerminals: (action) => {
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
        setTerminals: (action) => {
          sessions = typeof action === "function" ? action(sessions) : action;
        },
        updateConfigs,
      }),
    );

    act(() => result.current.renameSession(terminal.id, "renamed"));

    expect(sessions[0].name).toBe("renamed");
    expect(updateConfigs).toHaveBeenCalled();
  });

  it("updates properties on only the targeted live terminal", () => {
    const first = createTerminal();
    const second = {
      ...createTerminal(),
      id: createTerminalId(8),
      name: "Second",
    };
    let sessions = [first, second];
    const { result } = renderHook(() =>
      useTerminalMetadataActions({
        terminalsRef: { current: sessions },
        setTerminals: (action) => {
          sessions = typeof action === "function" ? action(sessions) : action;
        },
        updateConfigs: vi.fn(),
      }),
    );

    act(() => result.current.updateTerminalProperties(first.id, { fontSize: 18 }));

    expect(sessions[0].properties).toEqual({ fontSize: 18 });
    expect(sessions[1].properties).toEqual({});
  });

  it("toggles bookmarks on a live session and keeps them sorted", () => {
    const terminal = createTerminal();
    let sessions = [terminal];
    const { result } = renderHook(() =>
      useTerminalMetadataActions({
        terminalsRef: { current: [terminal] },
        setTerminals: (action) => {
          sessions = typeof action === "function" ? action(sessions) : action;
        },
        updateConfigs: vi.fn(),
      }),
    );

    act(() => result.current.toggleBookmark(terminal.id, 100, "echo hi"));
    expect(sessions[0].bookmarks).toEqual([{ line: 100, text: "echo hi" }]);

    act(() => result.current.toggleBookmark(terminal.id, 120, "ls"));
    act(() => result.current.toggleBookmark(terminal.id, 90, "pwd"));
    expect(sessions[0].bookmarks).toEqual([
      { line: 90, text: "pwd" },
      { line: 100, text: "echo hi" },
      { line: 120, text: "ls" },
    ]);

    act(() => result.current.toggleBookmark(terminal.id, 100, "echo hi"));
    expect(sessions[0].bookmarks).toEqual([
      { line: 90, text: "pwd" },
      { line: 120, text: "ls" },
    ]);
  });

  it("rejects reconnect when the transport does not support it", async () => {
    const terminal = createTerminal();
    const { result } = renderHook(() =>
      useTerminalReconnectAction({
        savedConfigs: [],
        terminalsRef: { current: [terminal] },
        setTerminals: vi.fn(),
        setWorkspaces: vi.fn(),
        establishingTerminalsRef: { current: new Set() },
      }),
    );

    await expect(result.current(terminal.id)).rejects.toMatchObject({
      code: "unsupported-operation",
    });
  });
});
