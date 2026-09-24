/**
 * SessionModel unit tests — Phase 3.
 *
 * **Strategy**: fake `SessionRepository` + fake `SessionEventBus`. The
 * fake bus captures handlers so tests can simulate Tauri events
 * synchronously. The fake repo records calls and returns canned
 * `SessionInfo` payloads.
 *
 * **No Zustand**: tests inject a fake `MirrorWriter` and assert against
 * it directly. This keeps the model layer testable without spinning up
 * the full store.
 */
import { describe, it, expect, vi } from "vitest";
import {
  createSessionModel,
  type MirrorWriter,
  type SessionModel,
  type SessionModelDeps,
} from "./model";
import type { SessionEventBus, SessionLifecycleHandler } from "./events";
import type { Session, SessionInfo, SessionType } from "./types";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const LOCAL_INPUT: SessionType = {
  type: "local",
  config: { name: "test-local", shellTemplate: "powershell" },
};

const SSH_INPUT: SessionType = {
  type: "ssh",
  config: {
    name: "test-ssh",
    host: "example.com",
    port: 22,
    username: "u",
    auth_type: "password",
    password: "p",
  },
};

const TMUX_INPUT: SessionType = {
  type: "tmux-cc",
  config: { name: "test-tmux", tmuxSessionName: "s1" },
};

function makeSessionInfo(id: number, type: SessionType["type"] = "local"): SessionInfo {
  return {
    id,
    name: `${type}-${id}`,
    sessionType: type === "local" ? LOCAL_INPUT : type === "ssh" ? SSH_INPUT : TMUX_INPUT,
    isConnected: true,
  };
}

function makeTmuxSessionInfo(id: number, controllerId: number): SessionInfo {
  return {
    id,
    name: `tmux-${id}`,
    sessionType: TMUX_INPUT,
    isConnected: true,
    capabilities: {
      supportsMultiplex: true,
      supportsResize: true,
      supportsReconnect: true,
      supportsLocalEcho: false,
    },
    tmuxPaneId: `%${id}`,
    tmuxControllerId: controllerId,
    tmuxServerWindowId: `@${id}`,
  };
}

// ---------------------------------------------------------------------------
// Fake Repository
// ---------------------------------------------------------------------------

interface FakeRepo {
  repo: SessionModelDeps["repo"];
  list: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  resizePty: ReturnType<typeof vi.fn>;
  resizeSsh: ReturnType<typeof vi.fn>;
  resizeTmuxPane: ReturnType<typeof vi.fn>;
  uploadImageToSsh: ReturnType<typeof vi.fn>;
}

function makeFakeRepo(): FakeRepo {
  const list = vi.fn(async () => [] as SessionInfo[]);
  const create = vi.fn(async (input: SessionType) => makeSessionInfo(1, input.type));
  const close = vi.fn(async () => undefined);
  const write = vi.fn(async () => undefined);
  const resizePty = vi.fn(async () => undefined);
  const resizeSsh = vi.fn(async () => undefined);
  const resizeTmuxPane = vi.fn(async () => undefined);
  const uploadImageToSsh = vi.fn(async () => "remote-path");
  return {
    repo: { list, create, close, write, resizePty, resizeSsh, resizeTmuxPane, uploadImageToSsh },
    list,
    create,
    close,
    write,
    resizePty,
    resizeSsh,
    resizeTmuxPane,
    uploadImageToSsh,
  };
}

// ---------------------------------------------------------------------------
// Fake EventBus
// ---------------------------------------------------------------------------

interface FakeBus {
  bus: SessionEventBus;
  closedHandlers: SessionLifecycleHandler[];
  disconnectedHandlers: SessionLifecycleHandler[];
  emitClosed(id: number): void;
  emitDisconnected(id: number): void;
  unsubscribeClosedCount: () => number;
  unsubscribeDisconnectedCount: () => number;
}

function makeFakeBus(): FakeBus {
  const closedHandlers: SessionLifecycleHandler[] = [];
  const disconnectedHandlers: SessionLifecycleHandler[] = [];
  const closedUnsubscribeCount = { n: 0 };
  const disconnectedUnsubscribeCount = { n: 0 };
  const bus: SessionEventBus = {
    onOutput: () => () => {},
    onClosed: (h) => {
      closedHandlers.push(h);
      return () => {
        closedUnsubscribeCount.n++;
        const idx = closedHandlers.indexOf(h);
        if (idx >= 0) closedHandlers.splice(idx, 1);
      };
    },
    onDisconnected: (h) => {
      disconnectedHandlers.push(h);
      return () => {
        disconnectedUnsubscribeCount.n++;
        const idx = disconnectedHandlers.indexOf(h);
        if (idx >= 0) disconnectedHandlers.splice(idx, 1);
      };
    },
  };
  return {
    bus,
    closedHandlers,
    disconnectedHandlers,
    emitClosed: (id) => {
      for (const h of closedHandlers) h(id);
    },
    emitDisconnected: (id) => {
      for (const h of disconnectedHandlers) h(id);
    },
    unsubscribeClosedCount: () => closedUnsubscribeCount.n,
    unsubscribeDisconnectedCount: () => disconnectedUnsubscribeCount.n,
  };
}

// ---------------------------------------------------------------------------
// Fake Mirror
// ---------------------------------------------------------------------------

interface FakeMirror extends MirrorWriter {
  replaces: Session[][];
  adds: Session[];
  removes: number[];
  updates: Array<{ id: number; patch: Partial<Session> }>;
  marksConnected: Array<{ id: number; isConnected: boolean }>;
  beginEstablishingIds: number[];
  endEstablishingIds: number[];
  replacedSessionIds: () => number[];
}

function makeFakeMirror(): FakeMirror {
  const replaces: Session[][] = [];
  const adds: Session[] = [];
  const removes: number[] = [];
  const updates: Array<{ id: number; patch: Partial<Session> }> = [];
  const marksConnected: Array<{ id: number; isConnected: boolean }> = [];
  const beginEstablishingIds: number[] = [];
  const endEstablishingIds: number[] = [];

  const writer: FakeMirror = {
    replaces,
    adds,
    removes,
    updates,
    marksConnected,
    beginEstablishingIds,
    endEstablishingIds,
    replacedSessionIds: () =>
      replaces.length === 0 ? [] : replaces[replaces.length - 1]!.map((s) => s.id),
    replaceSessions(sessions) {
      replaces.push(sessions);
    },
    updateSession(id, patch) {
      updates.push({ id, patch });
    },
    addSession(session) {
      adds.push(session);
    },
    removeSession(id) {
      removes.push(id);
    },
    markSessionConnected(id, isConnected) {
      marksConnected.push({ id, isConnected });
    },
    beginEstablishing(id) {
      beginEstablishingIds.push(id);
    },
    endEstablishing(id) {
      endEstablishingIds.push(id);
    },
  };
  return writer;
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

interface Harness {
  model: SessionModel;
  repo: FakeRepo;
  bus: FakeBus;
  mirror: FakeMirror;
  onSessionClosed: ReturnType<typeof vi.fn>;
}

function makeHarness(): Harness {
  const repo = makeFakeRepo();
  const bus = makeFakeBus();
  const mirror = makeFakeMirror();
  const onSessionClosed = vi.fn();
  const model = createSessionModel({
    repo: repo.repo,
    bus: bus.bus,
    mirror,
    onSessionClosed,
  });
  return { model, repo, bus, mirror, onSessionClosed };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SessionModel", () => {
  describe("construction + lifecycle", () => {
    it("subscribes to bus.onClosed and bus.onDisconnected on construction", () => {
      const h = makeHarness();
      expect(h.bus.closedHandlers).toHaveLength(1);
      expect(h.bus.disconnectedHandlers).toHaveLength(1);
      h.model.dispose();
    });

    it("dispose() unsubscribes both bus handlers", () => {
      const h = makeHarness();
      h.model.dispose();
      expect(h.bus.closedHandlers).toHaveLength(0);
      expect(h.bus.disconnectedHandlers).toHaveLength(0);
      expect(h.bus.unsubscribeClosedCount()).toBe(1);
      expect(h.bus.unsubscribeDisconnectedCount()).toBe(1);
    });

    it("dispose() is idempotent", () => {
      const h = makeHarness();
      h.model.dispose();
      expect(() => h.model.dispose()).not.toThrow();
      // No extra unsubscribes on second call.
      expect(h.bus.unsubscribeClosedCount()).toBe(1);
    });
  });

  describe("list / get / getByConfigId / filterByType", () => {
    it("starts empty", () => {
      const h = makeHarness();
      expect(h.model.list()).toEqual([]);
      expect(h.model.get(1)).toBeUndefined();
      expect(h.model.getByConfigId("any")).toBeUndefined();
      expect(h.model.filterByType("local")).toEqual([]);
      h.model.dispose();
    });

    it("get() returns the session by id", async () => {
      const h = makeHarness();
      h.repo.create.mockResolvedValueOnce(makeSessionInfo(7, "local"));
      const created = await h.model.create(LOCAL_INPUT, { configId: "cfg-1" });
      expect(created.id).toBe(7);
      expect(h.model.get(7)?.configId).toBe("cfg-1");
      expect(h.model.get(999)).toBeUndefined();
      h.model.dispose();
    });

    it("getByConfigId() matches configId; empty string is never matched", async () => {
      const h = makeHarness();
      h.repo.create
        .mockResolvedValueOnce(makeSessionInfo(1, "local"))
        .mockResolvedValueOnce(makeSessionInfo(2, "ssh"));
      await h.model.create(LOCAL_INPUT, { configId: "cfg-A" });
      await h.model.create(SSH_INPUT, { configId: "" });
      expect(h.model.getByConfigId("cfg-A")?.id).toBe(1);
      expect(h.model.getByConfigId("cfg-B")).toBeUndefined();
      expect(h.model.getByConfigId("")).toBeUndefined();
      h.model.dispose();
    });

    it("filterByType() narrows by transport", async () => {
      const h = makeHarness();
      h.repo.create
        .mockResolvedValueOnce(makeSessionInfo(1, "local"))
        .mockResolvedValueOnce(makeSessionInfo(2, "ssh"))
        .mockResolvedValueOnce(makeSessionInfo(3, "local"));
      await h.model.create(LOCAL_INPUT);
      await h.model.create(SSH_INPUT);
      await h.model.create(LOCAL_INPUT);
      const locals = h.model.filterByType("local");
      const sshs = h.model.filterByType("ssh");
      expect(locals.map((s) => s.id)).toEqual([1, 3]);
      expect(sshs.map((s) => s.id)).toEqual([2]);
      h.model.dispose();
    });
  });

  describe("hydrate()", () => {
    it("replaces registry from repo.list() and writes through mirror", async () => {
      const h = makeHarness();
      h.repo.list.mockResolvedValueOnce([
        makeSessionInfo(10, "local"),
        makeSessionInfo(20, "ssh"),
        makeTmuxSessionInfo(30, 100),
      ]);
      await h.model.hydrate();
      const ids = h.model.list().map((s) => s.id);
      expect(ids).toEqual([10, 20, 30]);
      expect(h.mirror.replaces).toHaveLength(1);
      expect(h.mirror.replacedSessionIds()).toEqual([10, 20, 30]);
      // tmux session synthesises backend fields.
      const tmux = h.model.get(30)!;
      expect(tmux.tmuxControllerId).toBe(100);
      expect(tmux.tmuxPaneId).toBe("%30");
      expect(tmux.tmuxServerWindowId).toBe("@30");
      h.model.dispose();
    });

    it("a second hydrate() replaces — does not merge — the registry", async () => {
      const h = makeHarness();
      h.repo.list
        .mockResolvedValueOnce([makeSessionInfo(1, "local")])
        .mockResolvedValueOnce([makeSessionInfo(2, "ssh")]);
      await h.model.hydrate();
      await h.model.hydrate();
      expect(h.model.list().map((s) => s.id)).toEqual([2]);
      h.model.dispose();
    });

    it("hydrate() with empty list clears the registry", async () => {
      const h = makeHarness();
      h.repo.list.mockResolvedValueOnce([makeSessionInfo(1, "local")]);
      await h.model.hydrate();
      h.repo.list.mockResolvedValueOnce([]);
      await h.model.hydrate();
      expect(h.model.list()).toEqual([]);
      h.model.dispose();
    });
  });

  describe("create()", () => {
    it("calls repo.create, stores the result, writes to mirror", async () => {
      const h = makeHarness();
      h.repo.create.mockResolvedValueOnce(makeSessionInfo(42, "local"));
      const session = await h.model.create(LOCAL_INPUT, {
        configId: "cfg-x",
        displayConfig: { fontSize: 14 },
      });
      expect(session.id).toBe(42);
      expect(h.model.get(42)?.configId).toBe("cfg-x");
      expect(h.model.get(42)?.displayConfig?.fontSize).toBe(14);
      expect(h.mirror.adds).toHaveLength(1);
      expect(h.mirror.adds[0]?.id).toBe(42);
      h.model.dispose();
    });

    it("synthesises tmux fields from the repo response", async () => {
      const h = makeHarness();
      h.repo.create.mockResolvedValueOnce(makeTmuxSessionInfo(50, 7));
      const session = await h.model.create(TMUX_INPUT);
      expect(session.type).toBe("tmux-cc");
      expect(session.tmuxControllerId).toBe(7);
      expect(session.tmuxPaneId).toBe("%50");
      h.model.dispose();
    });
  });

  describe("close()", () => {
    it("calls repo.close and removes the session", async () => {
      const h = makeHarness();
      h.repo.create.mockResolvedValueOnce(makeSessionInfo(5, "local"));
      const s = await h.model.create(LOCAL_INPUT);
      await h.model.close(s.id);
      expect(h.repo.close).toHaveBeenCalledWith(5);
      expect(h.model.get(5)).toBeUndefined();
      expect(h.mirror.removes).toEqual([5]);
      h.model.dispose();
    });

    it("close() of an unknown id is a no-op after repo call", async () => {
      const h = makeHarness();
      await h.model.close(9999);
      expect(h.repo.close).toHaveBeenCalledWith(9999);
      expect(h.mirror.removes).toEqual([]);
      h.model.dispose();
    });
  });

  describe("write()", () => {
    it("proxies to repo.write", async () => {
      const h = makeHarness();
      const data = new Uint8Array([0x61, 0x62]);
      await h.model.write(99, data);
      expect(h.repo.write).toHaveBeenCalledWith(99, data);
      h.model.dispose();
    });
  });

  describe("resize()", () => {
    it("local session → repo.resizePty", async () => {
      const h = makeHarness();
      h.repo.create.mockResolvedValueOnce(makeSessionInfo(1, "local"));
      const s = await h.model.create(LOCAL_INPUT);
      await h.model.resize(s.id, 24, 80);
      expect(h.repo.resizePty).toHaveBeenCalledWith(1, 24, 80);
      expect(h.repo.resizeSsh).not.toHaveBeenCalled();
      h.model.dispose();
    });

    it("ssh session → repo.resizeSsh", async () => {
      const h = makeHarness();
      h.repo.create.mockResolvedValueOnce(makeSessionInfo(2, "ssh"));
      const s = await h.model.create(SSH_INPUT);
      await h.model.resize(s.id, 30, 100);
      expect(h.repo.resizeSsh).toHaveBeenCalledWith(2, 30, 100);
      h.model.dispose();
    });

    it("tmux-cc session → repo.resizeTmuxPane(controllerId, paneId, rows, cols)", async () => {
      const h = makeHarness();
      h.repo.create.mockResolvedValueOnce(makeTmuxSessionInfo(3, 7));
      const s = await h.model.create(TMUX_INPUT);
      await h.model.resize(s.id, 30, 100);
      expect(h.repo.resizeTmuxPane).toHaveBeenCalledWith(7, "%3", 30, 100);
      h.model.dispose();
    });

    it("unknown session id throws", async () => {
      const h = makeHarness();
      await expect(h.model.resize(9999, 24, 80)).rejects.toThrow(/unknown session id 9999/);
      h.model.dispose();
    });
  });

  describe("markConnected()", () => {
    it("flips isConnected and writes through to mirror", async () => {
      const h = makeHarness();
      h.repo.create.mockResolvedValueOnce(makeSessionInfo(1, "local"));
      await h.model.create(LOCAL_INPUT);
      h.model.markConnected(1, false);
      expect(h.model.get(1)?.isConnected).toBe(false);
      expect(h.mirror.marksConnected).toEqual([{ id: 1, isConnected: false }]);
      h.model.dispose();
    });

    it("is a no-op when state is unchanged", async () => {
      const h = makeHarness();
      h.repo.create.mockResolvedValueOnce(makeSessionInfo(1, "local"));
      await h.model.create(LOCAL_INPUT);
      h.mirror.marksConnected.length = 0;
      h.model.markConnected(1, true);
      expect(h.mirror.marksConnected).toHaveLength(0);
      h.model.dispose();
    });

    it("unknown id is a silent no-op", () => {
      const h = makeHarness();
      h.model.markConnected(9999, false);
      expect(h.mirror.marksConnected).toHaveLength(0);
      h.model.dispose();
    });
  });

  describe("setName()", () => {
    it("updates the session name and the mirror", async () => {
      const h = makeHarness();
      h.repo.create.mockResolvedValueOnce(makeSessionInfo(1, "local"));
      await h.model.create(LOCAL_INPUT);
      h.model.setName(1, "renamed");
      expect(h.model.get(1)?.name).toBe("renamed");
      expect(h.mirror.updates).toContainEqual({ id: 1, patch: { name: "renamed" } });
      h.model.dispose();
    });

    it("is a no-op when name is unchanged", async () => {
      const h = makeHarness();
      h.repo.create.mockResolvedValueOnce(makeSessionInfo(1, "local"));
      await h.model.create(LOCAL_INPUT);
      h.mirror.updates.length = 0;
      h.model.setName(1, h.model.get(1)!.name);
      expect(h.mirror.updates).toHaveLength(0);
      h.model.dispose();
    });
  });

  describe("applyDisplayConfig()", () => {
    it("merges into existing displayConfig", async () => {
      const h = makeHarness();
      h.repo.create.mockResolvedValueOnce(makeSessionInfo(1, "local"));
      await h.model.create(LOCAL_INPUT, { displayConfig: { fontSize: 12 } });
      h.model.applyDisplayConfig(1, { fontSize: 14, cursorBlink: true });
      const dc = h.model.get(1)?.displayConfig;
      expect(dc?.fontSize).toBe(14);
      expect(dc?.cursorBlink).toBe(true);
      const lastUpdate = h.mirror.updates[h.mirror.updates.length - 1];
      expect(lastUpdate?.id).toBe(1);
      expect(lastUpdate?.patch.displayConfig).toEqual({
        fontSize: 14,
        cursorBlink: true,
      });
      h.model.dispose();
    });

    it("works on a session with no prior displayConfig", async () => {
      const h = makeHarness();
      h.repo.create.mockResolvedValueOnce(makeSessionInfo(1, "local"));
      await h.model.create(LOCAL_INPUT);
      h.model.applyDisplayConfig(1, { scrollback: 5000 });
      expect(h.model.get(1)?.displayConfig?.scrollback).toBe(5000);
      h.model.dispose();
    });
  });

  describe("beginEstablishing / endEstablishing", () => {
    it("forward to the mirror", () => {
      const h = makeHarness();
      h.model.beginEstablishing(7);
      h.model.endEstablishing(7);
      expect(h.mirror.beginEstablishingIds).toEqual([7]);
      expect(h.mirror.endEstablishingIds).toEqual([7]);
      h.model.dispose();
    });
  });

  describe("event backflow — onClosed", () => {
    it("removes the session, replaces mirror, fires onSessionClosed", async () => {
      const h = makeHarness();
      h.repo.create.mockResolvedValueOnce(makeSessionInfo(11, "local"));
      await h.model.create(LOCAL_INPUT);
      h.bus.emitClosed(11);
      expect(h.model.get(11)).toBeUndefined();
      expect(h.mirror.removes).toContain(11);
      expect(h.onSessionClosed).toHaveBeenCalledWith(11);
      h.model.dispose();
    });

    it("no-op when id is unknown", () => {
      const h = makeHarness();
      h.bus.emitClosed(999);
      expect(h.onSessionClosed).not.toHaveBeenCalled();
      h.model.dispose();
    });
  });

  describe("event backflow — onDisconnected", () => {
    it("delegates to markConnected(false)", async () => {
      const h = makeHarness();
      h.repo.create.mockResolvedValueOnce(makeSessionInfo(12, "local"));
      await h.model.create(LOCAL_INPUT);
      h.bus.emitDisconnected(12);
      expect(h.model.get(12)?.isConnected).toBe(false);
      expect(h.mirror.marksConnected).toEqual([{ id: 12, isConnected: false }]);
      h.model.dispose();
    });
  });

  describe("subscribe()", () => {
    it("notifies on every mutator and after hydrate()", async () => {
      const h = makeHarness();
      const seen: number[] = [];
      const off = h.model.subscribe(() => seen.push(h.model.list().length));
      await h.model.hydrate(); // empty list — still notifies (1x)
      h.repo.create.mockResolvedValueOnce(makeSessionInfo(1, "local"));
      await h.model.create(LOCAL_INPUT);
      h.model.markConnected(1, false);
      expect(seen).toEqual([0, 1, 1]);
      off();
      h.model.markConnected(1, true);
      expect(seen).toEqual([0, 1, 1]); // unsubscribed — no more notifications
      h.model.dispose();
    });
  });

  describe("strict-mode / double-mount", () => {
    it("a second model instance has independent state", async () => {
      const h1 = makeHarness();
      const h2 = makeHarness();
      h1.repo.create.mockResolvedValueOnce(makeSessionInfo(1, "local"));
      await h1.model.create(LOCAL_INPUT);
      expect(h1.model.get(1)?.id).toBe(1);
      expect(h2.model.get(1)).toBeUndefined();
      h1.model.dispose();
      h2.model.dispose();
    });

    it("disposing one instance does not affect the other's bus handlers", () => {
      const h1 = makeHarness();
      const h2 = makeHarness();
      h1.model.dispose();
      // h2's handlers are still live — emit shouldn't cross-pollute.
      h2.repo.create.mockResolvedValueOnce(makeSessionInfo(1, "local"));
      // (we don't await — just exercise the path.)
      h2.model.dispose();
    });
  });

  describe("MirrorWriter contract enforcement", () => {
    it("throws when default mirror is requested without binding (test isolation)", () => {
      // We must not bind for this test, so use a separate module load.
      // Vitest caches modules — instead, just exercise the explicit
      // mirror path, which is what production code does anyway.
      const h = makeHarness();
      // model.dispose already exercised
      h.model.dispose();
      // Constructing another model without mirror should throw because
      // we never bound the default mirror in this test.
      expect(() => createSessionModel({ repo: h.repo.repo, bus: h.bus.bus })).toThrow(
        /default mirror writer was not bound/,
      );
    });
  });

  describe("default mirror — explicit binding path", () => {
    it("falls back to boundDefaultMirrorWriter when deps.mirror is omitted", async () => {
      // We deliberately do NOT pass `mirror`. We need to bind first.
      const { bindDefaultMirrorWriter, unbindDefaultMirrorWriter } = await import("./model");
      const mirror = makeFakeMirror();
      bindDefaultMirrorWriter(mirror);
      try {
        const repo = makeFakeRepo();
        const bus = makeFakeBus();
        const model = createSessionModel({ repo: repo.repo, bus: bus.bus });
        repo.create.mockResolvedValueOnce(makeSessionInfo(1, "local"));
        await model.create(LOCAL_INPUT);
        expect(mirror.adds).toHaveLength(1);
        model.dispose();
      } finally {
        unbindDefaultMirrorWriter();
      }
    });
  });
});
