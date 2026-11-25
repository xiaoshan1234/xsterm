/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTerminalId } from "../../../models";
import {
  terminalSessionActions,
  terminalStreamActions,
  type Terminal,
} from "../../../features/terminal";
import { useTerminalStreamActions } from "./useTerminalStreamActions";

function createTerminal(id: number): Terminal {
  return {
    id: createTerminalId(id),
    configId: `config-${id}`,
    name: `terminal-${id}`,
    type: "local",
    isConnected: true,
    kind: { type: "local", shell: "pwsh", cwd: "C:\\" },
    properties: {},
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useTerminalStreamActions", () => {
  it("encodes text to bytes before writing to the terminal stream", async () => {
    vi.spyOn(terminalStreamActions, "writeBytes").mockResolvedValue(undefined);
    const { result } = renderHook(() => useTerminalStreamActions({ setTerminals: vi.fn() }));
    const terminalId = createTerminalId(7);

    await act(() => result.current.writeTerminal(terminalId, "hello"));

    const writeBytes = vi.mocked(terminalStreamActions.writeBytes);
    expect(writeBytes).toHaveBeenCalledTimes(1);
    expect(writeBytes.mock.calls[0][0]).toBe(terminalId);
    expect(Array.from(writeBytes.mock.calls[0][1])).toEqual([104, 101, 108, 108, 111]);
  });

  it("forwards terminal resize to the session adapter", async () => {
    vi.spyOn(terminalSessionActions, "resizeTerminal").mockResolvedValue(undefined);
    const { result } = renderHook(() => useTerminalStreamActions({ setTerminals: vi.fn() }));
    const terminalId = createTerminalId(7);

    await act(() => result.current.resizeTerminal(terminalId, 24, 80));

    expect(terminalSessionActions.resizeTerminal).toHaveBeenCalledWith(terminalId, 24, 80);
  });

  it("uploads an image through the SSH session adapter and returns its url", async () => {
    vi.spyOn(terminalSessionActions, "uploadImageToSshTerminal").mockResolvedValue(
      "https://example.com/a.png",
    );
    const { result } = renderHook(() => useTerminalStreamActions({ setTerminals: vi.fn() }));
    const terminalId = createTerminalId(7);
    const bytes = new Uint8Array([1, 2, 3]);

    const url = await act(() =>
      result.current.uploadImageToSshTerminal(terminalId, "a.png", bytes),
    );

    expect(url).toBe("https://example.com/a.png");
    expect(terminalSessionActions.uploadImageToSshTerminal).toHaveBeenCalledWith(
      terminalId,
      "a.png",
      bytes,
    );
  });

  it("updates only the touched terminal's activity timestamp", () => {
    vi.spyOn(Date, "now").mockReturnValue(1234);
    const target = createTerminal(7);
    const other = createTerminal(8);
    let sessions: Terminal[] = [target, other];
    const { result } = renderHook(() =>
      useTerminalStreamActions({
        setTerminals: (action) => {
          sessions = typeof action === "function" ? action(sessions) : action;
        },
      }),
    );

    act(() => result.current.touchTerminalActivity(target.id));

    expect(sessions[0].lastActivityAt).toBe(1234);
    expect(sessions[1].lastActivityAt).toBeUndefined();
  });
});
