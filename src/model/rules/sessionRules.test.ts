import { describe, expect, it } from "vitest";
import type { Workspace } from "../entities/workspace";
import type { SessionType } from "../entities/session";
import {
  assertSessionNotUsedElsewhere,
  buildFrontendSession,
  dispatchByType,
  getUniqueWindowName,
} from "./sessionRules";

function makeLocalInfo(
  overrides: Partial<{ id: number; name: string; isConnected: boolean }> = {},
) {
  return {
    id: 1,
    name: "alpha",
    isConnected: true,
    sessionType: {
      type: "local",
      config: { shell: "/bin/sh", cwd: "/" },
    } satisfies SessionType,
    ...overrides,
  };
}

function makeSshInfo(overrides: Partial<{ id: number; name: string; isConnected: boolean }> = {}) {
  return {
    id: 2,
    name: "beta",
    isConnected: true,
    sessionType: {
      type: "ssh",
      config: {
        host: "h",
        port: 22,
        username: "u",
        auth_type: "password" as const,
        password: "p",
      },
    } satisfies SessionType,
    ...overrides,
  };
}

function makeTmuxInfo(overrides: Partial<{ id: number; name: string; isConnected: boolean }> = {}) {
  return {
    id: 3,
    name: "gamma",
    isConnected: true,
    sessionType: { type: "tmux-cc", config: {} } satisfies SessionType,
    ...overrides,
  };
}

describe("buildFrontendSession", () => {
  it("builds a local Session with timestamps + no tmux fields", () => {
    const before = Date.now();
    const session = buildFrontendSession(makeLocalInfo(), "cfg-1", "local");
    const after = Date.now();

    expect(session.id).toBe(1);
    expect(session.configId).toBe("cfg-1");
    expect(session.name).toBe("alpha");
    expect(session.type).toBe("local");
    expect(session.isConnected).toBe(true);
    expect(session.sessionType.type).toBe("local");
    expect(session.displayConfig).toBeUndefined();
    expect(session.tmuxPaneId).toBeUndefined();
    expect(session.tmuxControllerId).toBeUndefined();
    expect(session.tmuxWindowId).toBeUndefined();
    expect(session.xstermWindowId).toBeUndefined();
    expect(session.isHidden).toBeUndefined();
    expect(session.createdAt).toBeGreaterThanOrEqual(before);
    expect(session.createdAt).toBeLessThanOrEqual(after);
    expect(session.lastActivityAt).toBe(session.createdAt);
  });

  it("builds an ssh Session with no tmux fields", () => {
    const session = buildFrontendSession(makeSshInfo(), "cfg-2", "ssh");
    expect(session.type).toBe("ssh");
    expect(session.id).toBe(2);
    expect(session.sessionType.type).toBe("ssh");
  });

  it("forwards tmux fields when present on the info payload", () => {
    const info = {
      ...makeTmuxInfo(),
      tmuxPaneId: "%5",
      tmuxControllerId: 42,
      tmuxWindowId: "@1",
      xstermWindowId: 7,
      isHidden: true,
    };
    const session = buildFrontendSession(info, "cfg-3", "tmux-cc");
    expect(session.type).toBe("tmux-cc");
    expect(session.tmuxPaneId).toBe("%5");
    expect(session.tmuxControllerId).toBe(42);
    expect(session.tmuxWindowId).toBe("@1");
    expect(session.xstermWindowId).toBe(7);
    expect(session.isHidden).toBe(true);
  });

  it("omits undefined tmux fields (does not assign undefined keys)", () => {
    const session = buildFrontendSession(makeTmuxInfo(), "cfg-3", "tmux-cc");
    expect("tmuxPaneId" in session).toBe(false);
    expect("tmuxControllerId" in session).toBe(false);
    expect("tmuxWindowId" in session).toBe(false);
    expect("xstermWindowId" in session).toBe(false);
    expect("isHidden" in session).toBe(false);
  });

  it("carries an optional displayConfig through verbatim", () => {
    const dc = { fontSize: 14, cursorStyle: "bar" as const };
    const session = buildFrontendSession(makeLocalInfo(), "cfg-1", "local", dc);
    expect(session.displayConfig).toEqual(dc);
  });
});

describe("dispatchByType", () => {
  it("routes 'local' to the local handler", async () => {
    const r = await dispatchByType(
      "local",
      () => Promise.resolve("L"),
      () => Promise.resolve("S"),
      () => Promise.resolve("T"),
    );
    expect(r).toBe("L");
  });

  it("routes 'ssh' to the ssh handler", async () => {
    const r = await dispatchByType(
      "ssh",
      () => Promise.resolve("L"),
      () => Promise.resolve("S"),
      () => Promise.resolve("T"),
    );
    expect(r).toBe("S");
  });

  it("routes 'tmux-cc' to the tmux handler", async () => {
    const r = await dispatchByType(
      "tmux-cc",
      () => Promise.resolve("L"),
      () => Promise.resolve("S"),
      () => Promise.resolve("T"),
    );
    expect(r).toBe("T");
  });

  it("awaits the selected promise and propagates its value", async () => {
    const r = await dispatchByType<number>(
      "ssh",
      async () => 1,
      async () => {
        await Promise.resolve();
        return 2;
      },
      async () => 3,
    );
    expect(r).toBe(2);
  });
});

describe("getUniqueWindowName", () => {
  it("returns the base name unchanged (uniqueness enforced by prefix at render)", () => {
    expect(getUniqueWindowName([], "ws-1", "alpha")).toBe("alpha");
    expect(
      getUniqueWindowName(
        [{ id: "ws-1", name: "ws", windows: [], activeWindowId: null, sessionIds: [] }],
        "ws-1",
        "beta",
        "win-1",
      ),
    ).toBe("beta");
  });
});

describe("assertSessionNotUsedElsewhere", () => {
  const wsWith = (id: string, windowId: string, sessionId: number): Workspace => ({
    id,
    name: id,
    windows: [
      {
        id: windowId,
        name: windowId,
        rootPane: {
          id: "root",
          type: "leaf",
          size: 1,
          sessionId,
        },
        activePaneId: null,
      },
    ],
    activeWindowId: null,
    sessionIds: [sessionId],
  });

  it("throws when the session is used in a different window", () => {
    expect(() =>
      assertSessionNotUsedElsewhere(
        [wsWith("ws-1", "win-a", 7), wsWith("ws-2", "win-b", 7)],
        "ws-1",
        "win-a",
        7,
      ),
    ).toThrow("Session is already used in another window");
  });

  it("does not throw when the only usage is the current window", () => {
    expect(() =>
      assertSessionNotUsedElsewhere([wsWith("ws-1", "win-a", 7)], "ws-1", "win-a", 7),
    ).not.toThrow();
  });

  it("treats null current ids as 'no current window' (throws if found anywhere)", () => {
    expect(() =>
      assertSessionNotUsedElsewhere([wsWith("ws-1", "win-a", 7)], null, null, 7),
    ).toThrow("Session is already used in another window");
  });

  it("does not throw when no window contains the session", () => {
    expect(() =>
      assertSessionNotUsedElsewhere([wsWith("ws-1", "win-a", 7)], "ws-1", "win-a", 99),
    ).not.toThrow();
  });
});
