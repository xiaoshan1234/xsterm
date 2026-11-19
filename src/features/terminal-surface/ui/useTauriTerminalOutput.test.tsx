/** @vitest-environment jsdom */

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { type Terminal } from "@xterm/xterm";
import { createTerminalId } from "../../../models";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearTerminalOutput } from "../application/terminalOutputBuffer";
import { createTestApplication } from "../../../test/createTestApplication";
import { useTauriTerminalOutput } from "./useTauriTerminalOutput";

const mocks = vi.hoisted(() => ({
  subscribeTerminalOutput: vi.fn(),
}));

const testApplication = createTestApplication({
  terminal: {
    touchTerminalActivity: vi.fn(),
    terminals: [],
  },
});

const outputPorts = {
  stream: {
    subscribeOutput: mocks.subscribeTerminalOutput,
  },
  clipboard: {
    writeText: vi.fn(async () => undefined),
  },
  tmux: {
    capturePane: vi.fn(async () => ""),
  },
};

afterEach(() => {
  cleanup();
  clearTerminalOutput(createTerminalId(42));
  vi.clearAllMocks();
});

describe("useTauriTerminalOutput", () => {
  it("does not replay output that arrived during subscription setup", async () => {
    mocks.subscribeTerminalOutput.mockImplementation(
      async (_terminalId: unknown, onOutput: (data: Uint8Array) => void) => {
        onOutput(new TextEncoder().encode("prompt $ "));
        return vi.fn();
      },
    );
    const write = vi.fn();
    const xterm = { write } as unknown as Terminal;

    renderHook(
      () => useTauriTerminalOutput({ current: xterm }, createTerminalId(42), outputPorts),
      {
        wrapper: testApplication.Application,
      },
    );

    await waitFor(() => expect(write).toHaveBeenCalled());
    expect(write.mock.calls.map(([text]) => text)).toEqual(["prompt $ "]);
  });
});
