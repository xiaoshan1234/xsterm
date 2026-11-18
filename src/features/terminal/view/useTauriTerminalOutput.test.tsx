/** @vitest-environment jsdom */

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { type Terminal } from "@xterm/xterm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearTerminalOutput } from "../../../shared/utils/terminalOutputBuffer";
import { useTauriTerminalOutput } from "./useTauriTerminalOutput";

const mocks = vi.hoisted(() => ({
  subscribeTerminalOutput: vi.fn(),
}));

vi.mock("../state/TerminalRuntimeContext", () => ({
  useTerminalRuntime: () => ({
    touchTerminalActivity: vi.fn(),
    terminals: [],
  }),
}));

vi.mock("../application/terminalStreamActions", () => ({
  terminalStreamActions: {
    subscribeOutput: mocks.subscribeTerminalOutput,
  },
}));

vi.mock("../application/terminalClipboard", () => ({
  terminalClipboard: {
    writeText: vi.fn(async () => undefined),
  },
}));

vi.mock("../../tmux", () => ({
  tmuxControllerActions: {
    capturePane: vi.fn(async () => ""),
  },
}));

afterEach(() => {
  cleanup();
  clearTerminalOutput(42);
  vi.clearAllMocks();
});

describe("useTauriTerminalOutput", () => {
  it("does not replay output that arrived during subscription setup", async () => {
    mocks.subscribeTerminalOutput.mockImplementation(
      async (_terminalId: number, onOutput: (data: Uint8Array) => void) => {
        onOutput(new TextEncoder().encode("prompt $ "));
        return vi.fn();
      },
    );
    const write = vi.fn();
    const xterm = { write } as unknown as Terminal;

    renderHook(() => useTauriTerminalOutput({ current: xterm }, 42));

    await waitFor(() => expect(write).toHaveBeenCalled());
    expect(write.mock.calls.map(([text]) => text)).toEqual(["prompt $ "]);
  });
});
