import { describe, expect, it } from "vitest";
import {
  assertSessionNotUsedElsewhere,
  buildFrontendSession,
  dispatchByType,
  getUniqueWindowName,
} from "./useSessionActions.helpers";
import type { Session, SessionDisplayConfig, Window, Workspace } from "../../types/session";
import { isSessionUsedInOtherWindow } from "./paneUtils";

// ---------- Fixtures --------------------------------------------------------

function leafWindow(id: string, name: string, sessionIds: number[]): Window {
  return {
    id,
    name,
    windowType: "terminal",
    activePaneId: "p",
    rootPane: {
      id: "p",
      type: "leaf",
      size: 100,
      sessionId: sessionIds[0],
    },
  };
}

function workspace(id: string, name: string, windows: Window[]): Workspace {
  return {
    id,
    name,
    windows,
    activeWindowId: windows[0]?.id ?? null,
    sessionIds: windows.flatMap((w) =>
      w.rootPane.type === "leaf" && w.rootPane.sessionId !== undefined
        ? [w.rootPane.sessionId]
        : [],
    ),
  };
}

const displayConfig: SessionDisplayConfig = { lineTimestamp: true };

// ---------- dispatchByType --------------------------------------------------

describe("dispatchByType", () => {
  it("invokes the local creator for type 'local'", async () => {
    const local = async () =>
      ({
        id: 1,
        name: "L",
        isConnected: true,
        sessionType: { type: "local", config: { shell: "", cwd: "" } },
      }) as const;
    const ssh = async () =>
      ({
        id: 2,
        name: "S",
        isConnected: true,
        sessionType: {
          type: "ssh",
          config: { host: "", username: "", port: 22, auth_type: "password" },
        },
      }) as const;

    const result = await dispatchByType("local", local, ssh);
    expect(result.id).toBe(1);
  });

  it("invokes the ssh creator for type 'ssh'", async () => {
    const local = async () =>
      ({
        id: 1,
        name: "L",
        isConnected: true,
        sessionType: { type: "local", config: { shell: "", cwd: "" } },
      }) as const;
    const ssh = async () =>
      ({
        id: 2,
        name: "S",
        isConnected: true,
        sessionType: {
          type: "ssh",
          config: { host: "", username: "", port: 22, auth_type: "password" },
        },
      }) as const;

    const result = await dispatchByType("ssh", local, ssh);
    expect(result.id).toBe(2);
  });

  it("throws on an unknown type", async () => {
    await expect(
      dispatchByType(
        "weird" as never,
        async () =>
          ({
            id: 1,
            name: "L",
            isConnected: true,
            sessionType: { type: "local", config: { shell: "", cwd: "" } },
          }) as const,
        async () =>
          ({
            id: 2,
            name: "S",
            isConnected: true,
            sessionType: {
              type: "ssh",
              config: { host: "", username: "", port: 22, auth_type: "password" },
            },
          }) as const,
      ),
    ).rejects.toThrow(/Unknown session type/);
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

// ---------- buildFrontendSession -------------------------------------------

describe("buildFrontendSession", () => {
  const info = {
    id: 7,
    name: "session-7",
    isConnected: true,
    sessionType: { type: "local", config: { shell: "/bin/zsh", cwd: "/" } } as const,
  };

  it("maps all info fields onto the Session object", () => {
    const session = buildFrontendSession(info, "config-1", "local");
    expect(session).toEqual<Session>({
      id: 7,
      configId: "config-1",
      name: "session-7",
      type: "local",
      isConnected: true,
      sessionType: info.sessionType,
      displayConfig: undefined,
      createdAt: expect.any(Number),
      lastActivityAt: expect.any(Number),
    });
  });

  it("forwards displayConfig when provided", () => {
    const session = buildFrontendSession(info, "config-1", "local", displayConfig);
    expect(session.displayConfig).toBe(displayConfig);
  });

  it("preserves the type discriminator (ssh)", () => {
    const sshInfo = {
      ...info,
      sessionType: {
        type: "ssh" as const,
        config: { host: "h", username: "u", port: 22, auth_type: "password" as const },
      },
    };
    const session = buildFrontendSession(sshInfo, "cfg", "ssh");
    expect(session.type).toBe("ssh");
    expect(session.sessionType.type).toBe("ssh");
  });
});

// ---------- assertSessionNotUsedElsewhere ----------------------------------

describe("assertSessionNotUsedElsewhere", () => {
  it("does not throw when the session is not used in any other window", () => {
    const ws = workspace("ws1", "default", [leafWindow("w1", "Window", [42])]);
    expect(() => assertSessionNotUsedElsewhere([ws], "ws1", "w1", 42)).not.toThrow();
  });

  it("does not throw when the session is used in the current workspace+window only", () => {
    const ws = workspace("ws1", "default", [leafWindow("w1", "Window", [42])]);
    expect(() => assertSessionNotUsedElsewhere([ws], "ws1", "w1", 42)).not.toThrow();
  });

  it("throws when the session is used in a different workspace", () => {
    const ws1 = workspace("ws1", "default", [leafWindow("w1", "Window", [42])]);
    const ws2 = workspace("ws2", "default", [leafWindow("w2", "Window", [42])]);
    expect(() => assertSessionNotUsedElsewhere([ws1, ws2], "ws2", "w2", 42)).toThrow(
      /already used/,
    );
  });

  it("throws when the session is used in a different window of the same workspace", () => {
    const ws = workspace("ws1", "default", [
      leafWindow("w1", "Window", [42]),
      leafWindow("w2", "Window-2", [42]),
    ]);
    expect(() => assertSessionNotUsedElsewhere([ws], "ws1", "w2", 42)).toThrow(/already used/);
  });

  it("throws when currentWindowId is null and the session exists anywhere", () => {
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
