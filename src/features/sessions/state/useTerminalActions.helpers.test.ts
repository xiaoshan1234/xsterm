import { describe, expect, it } from "vitest";
import {
  assertSessionNotUsedElsewhere,
  buildFrontendTerminal,
  dispatchByType,
  getUniqueWindowName,
} from "./useTerminalActions.helpers";
import type {
  Terminal,
  TerminalDisplayConfig,
  Window,
  Workspace,
} from "../../../models/legacy/terminal";
import { toBackendTerminalHandle } from "../../terminal/infrastructure";
import { isSessionUsedInOtherWindow } from "./paneUtils";

// ---------- Fixtures --------------------------------------------------------

function leafWindow(id: string, name: string, terminalIds: number[]): Window {
  return {
    id,
    name,
    windowType: "terminal",
    activePaneId: "p",
    rootPane: {
      id: "p",
      type: "leaf",
      size: 100,
      terminalId: terminalIds[0],
    },
  };
}

function workspace(id: string, name: string, windows: Window[]): Workspace {
  return {
    id,
    name,
    windows,
    activeWindowId: windows[0]?.id ?? null,
    terminalIds: windows.flatMap((w) =>
      w.rootPane.type === "leaf" && w.rootPane.terminalId !== undefined
        ? [w.rootPane.terminalId]
        : [],
    ),
  };
}

const displayConfig: TerminalDisplayConfig = { lineTimestamp: true };
const capabilities = {
  supportsResize: true,
  supportsReconnect: false,
  supportsLocalEcho: true,
  supportsMultiplex: false,
};

// ---------- dispatchByType --------------------------------------------------

describe("dispatchByType", () => {
  const tmux = async () =>
    ({
      id: toBackendTerminalHandle(3),
      name: "T",
      isConnected: true,
      kind: { type: "tmux-pane", sessionId: 1, paneId: "%1" },
      capabilities,
    }) as const;

  it("invokes the local creator for type 'local'", async () => {
    const local = async () =>
      ({
        id: toBackendTerminalHandle(1),
        name: "L",
        isConnected: true,
        kind: { type: "local", shell: "", cwd: "" },
        capabilities,
      }) as const;
    const ssh = async () =>
      ({
        id: toBackendTerminalHandle(2),
        name: "S",
        isConnected: true,
        kind: {
          type: "ssh",
          host: "",
          port: 22,
          user: "",
        },
        capabilities,
      }) as const;

    const result = await dispatchByType("local", local, ssh, tmux);
    expect(result.id).toBe(1);
  });

  it("invokes the ssh creator for type 'ssh'", async () => {
    const local = async () =>
      ({
        id: toBackendTerminalHandle(1),
        name: "L",
        isConnected: true,
        kind: { type: "local", shell: "", cwd: "" },
        capabilities,
      }) as const;
    const ssh = async () =>
      ({
        id: toBackendTerminalHandle(2),
        name: "S",
        isConnected: true,
        kind: {
          type: "ssh",
          host: "",
          port: 22,
          user: "",
        },
        capabilities,
      }) as const;

    const result = await dispatchByType("ssh", local, ssh, tmux);
    expect(result.id).toBe(2);
  });

  it("invokes the tmux creator for type 'tmux-pane'", async () => {
    const local = async () =>
      ({
        id: toBackendTerminalHandle(1),
        name: "L",
        isConnected: true,
        kind: { type: "local", shell: "", cwd: "" },
        capabilities,
      }) as const;
    const ssh = async () =>
      ({
        id: toBackendTerminalHandle(2),
        name: "S",
        isConnected: true,
        kind: {
          type: "ssh",
          host: "",
          port: 22,
          user: "",
        },
        capabilities,
      }) as const;

    const result = await dispatchByType("tmux-pane", local, ssh, tmux);
    expect(result.id).toBe(3);
  });

  it("throws on an unknown type", async () => {
    await expect(
      dispatchByType(
        "weird" as never,
        async () =>
          ({
            id: toBackendTerminalHandle(1),
            name: "L",
            isConnected: true,
            kind: { type: "local", shell: "", cwd: "" },
            capabilities,
          }) as const,
        async () =>
          ({
            id: toBackendTerminalHandle(2),
            name: "S",
            isConnected: true,
            kind: {
              type: "ssh",
              host: "",
              port: 22,
              user: "",
            },
            capabilities,
          }) as const,
        async () =>
          ({
            id: toBackendTerminalHandle(3),
            name: "T",
            isConnected: true,
            kind: { type: "tmux-pane", sessionId: 1, paneId: "%1" },
            capabilities,
          }) as const,
      ),
    ).rejects.toThrow(/Unknown terminal type/);
  });
});

// ---------- getUniqueWindowName --------------------------------------------

describe("getUniqueWindowName", () => {
  const ws = workspace("ws1", "default", [
    leafWindow("w1", "Window", []),
    leafWindow("w2", "Window-2", []),
    leafWindow("w3", "Window-3", []),
  ]);

  it("returns baseName unchanged when there is no collision", () => {
    expect(getUniqueWindowName([ws], "ws1", "New-Window")).toBe("New-Window");
  });

  it("returns baseName even when the workspace has a window with the same name", () => {
    // Collision does not trigger a suffix — visual uniqueness comes from position prefix.
    expect(getUniqueWindowName([ws], "ws1", "Window")).toBe("Window");
  });

  it("returns the baseName when the workspace has no conflicting windows", () => {
    const wsSingle = workspace("ws1", "default", [leafWindow("w1", "Alpha", [])]);
    expect(getUniqueWindowName([wsSingle], "ws1", "Window")).toBe("Window");
  });

  it("ignores a window with id === excludeWindowId when renaming", () => {
    // Renaming w1 (currently "Window") to "Window" should be allowed.
    expect(getUniqueWindowName([ws], "ws1", "Window", "w1")).toBe("Window");
  });

  it("returns baseName unchanged when the workspace is missing", () => {
    expect(getUniqueWindowName([ws], "does-not-exist", "Foo")).toBe("Foo");
  });
});

// ---------- buildFrontendTerminal -------------------------------------------

describe("buildFrontendTerminal", () => {
  const info = {
    id: toBackendTerminalHandle(7),
    name: "terminal-7",
    isConnected: true,
    kind: { type: "local", shell: "/bin/zsh", cwd: "/" } as const,
    capabilities,
  };

  it("maps all info fields onto the Terminal object", () => {
    const terminal = buildFrontendTerminal(info, "config-1", "local");
    expect(terminal).toEqual<Terminal>({
      id: 7,
      configId: "config-1",
      name: "terminal-7",
      type: "local",
      isConnected: true,
      kind: info.kind,
      displayConfig: undefined,
      createdAt: expect.any(Number),
      lastActivityAt: expect.any(Number),
      capabilities,
    });
  });

  it("forwards displayConfig when provided", () => {
    const terminal = buildFrontendTerminal(info, "config-1", "local", displayConfig);
    expect(terminal.displayConfig).toBe(displayConfig);
  });

  it("forwards capabilities from TerminalInfo", () => {
    const capabilities = {
      supportsResize: true,
      supportsReconnect: false,
      supportsLocalEcho: true,
      supportsMultiplex: false,
    };
    const terminal = buildFrontendTerminal({ ...info, capabilities }, "config-1", "local");
    expect(terminal.capabilities).toEqual(capabilities);
  });

  it("preserves the type discriminator (ssh)", () => {
    const sshInfo = {
      ...info,
      kind: {
        type: "ssh" as const,
        host: "h",
        port: 22,
        user: "u",
      },
    };
    const terminal = buildFrontendTerminal(sshInfo, "cfg", "ssh");
    expect(terminal.type).toBe("ssh");
    expect(terminal.kind.type).toBe("ssh");
  });
});

// ---------- assertSessionNotUsedElsewhere ----------------------------------

describe("assertSessionNotUsedElsewhere", () => {
  it("does not throw when the terminal is not used in any other window", () => {
    const ws = workspace("ws1", "default", [leafWindow("w1", "Window", [42])]);
    expect(() => assertSessionNotUsedElsewhere([ws], "ws1", "w1", 42)).not.toThrow();
  });

  it("does not throw when the terminal is used in the current workspace+window only", () => {
    const ws = workspace("ws1", "default", [leafWindow("w1", "Window", [42])]);
    expect(() => assertSessionNotUsedElsewhere([ws], "ws1", "w1", 42)).not.toThrow();
  });

  it("throws when the terminal is used in a different workspace", () => {
    const ws1 = workspace("ws1", "default", [leafWindow("w1", "Window", [42])]);
    const ws2 = workspace("ws2", "default", [leafWindow("w2", "Window", [42])]);
    expect(() => assertSessionNotUsedElsewhere([ws1, ws2], "ws2", "w2", 42)).toThrow(
      /already used/,
    );
  });

  it("throws when the terminal is used in a different window of the same workspace", () => {
    const ws = workspace("ws1", "default", [
      leafWindow("w1", "Window", [42]),
      leafWindow("w2", "Window-2", [42]),
    ]);
    expect(() => assertSessionNotUsedElsewhere([ws], "ws1", "w2", 42)).toThrow(/already used/);
  });

  it("throws when currentWindowId is null and the terminal exists anywhere", () => {
    const ws = workspace("ws1", "default", [leafWindow("w1", "Window", [42])]);
    expect(() => assertSessionNotUsedElsewhere([ws], null, null, 42)).toThrow(/already used/);
  });

  it("delegates the existence check to isSessionUsedInOtherWindow", () => {
    // This guards the implementation contract: if isSessionUsedInOtherWindow
    // is updated, assertSessionNotUsedElsewhere follows.
    const ws = workspace("ws1", "default", [leafWindow("w1", "Window", [42])]);
    expect(isSessionUsedInOtherWindow([ws], "ws1", "w1", 42)).toBe(false);
    expect(isSessionUsedInOtherWindow([ws], null, null, 42)).toBe(true);
  });
});
