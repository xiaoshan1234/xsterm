/**
 * @vitest-environment jsdom
 *
 * SessionBridge tests (Phase 3) — verify the bridge observes the
 * `SessionModel` and runs the workspace cleanup on session-close.
 *
 * **What changed vs. the previous test file**:
 * - The bridge no longer subscribes to `infraEventBus` directly. The
 *   model owns the bus subscriptions. The bridge subscribes to
 *   `model.subscribe()` and diffs the session list to detect closes.
 * - The bridge now takes `model: SessionModel` as a prop. Tests
 *   construct a model with a fake repo + fake bus and pass it in.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { SessionBridge, runWorkspaceCleanupForSessions } from "./sessionBridge";
import { useSessionStore } from "../session/store";
import { useWorkspaceStore } from "../workspace/store";
import {
  createSessionModel,
  type MirrorWriter,
  type SessionModel,
} from "../../model/session/model";
import type { SessionInfo, SessionType } from "../../model/session";

// ---------------------------------------------------------------------------
// Test helpers — pure-TS fakes, no vi.mock needed.
// ---------------------------------------------------------------------------

const LOCAL_INPUT: SessionType = {
  type: "local",
  config: { name: "test" },
};

interface FakeBus {
  closedHandlers: Array<(sessionId: number) => void>;
  disconnectedHandlers: Array<(sessionId: number) => void>;
  emitClosed(id: number): void;
  emitDisconnected(id: number): void;
}

function makeFakeBus(): FakeBus {
  const closedHandlers: Array<(sessionId: number) => void> = [];
  const disconnectedHandlers: Array<(sessionId: number) => void> = [];
  return {
    closedHandlers,
    disconnectedHandlers,
    emitClosed(id) {
      for (const h of closedHandlers) h(id);
    },
    emitDisconnected(id) {
      for (const h of disconnectedHandlers) h(id);
    },
  };
}

function makeFakeRepo(opts?: { sessionInfo?: SessionInfo }) {
  const sessionInfo = opts?.sessionInfo ?? {
    id: 1,
    name: "test",
    sessionType: LOCAL_INPUT,
    isConnected: true,
  };
  return {
    list: vi.fn(async () => []),
    create: vi.fn(async () => sessionInfo),
    close: vi.fn(async () => undefined),
    write: vi.fn(async () => undefined),
    resizePty: vi.fn(),
    resizeSsh: vi.fn(),
    resizeTmuxPane: vi.fn(),
    uploadImageToSsh: vi.fn(),
  };
}

function makeFakeMirror(): MirrorWriter {
  return {
    replaceSessions: () => {},
    updateSession: () => {},
    addSession: () => {},
    removeSession: () => {},
    markSessionConnected: () => {},
    beginEstablishing: () => {},
    endEstablishing: () => {},
  };
}

interface Harness {
  model: SessionModel;
  bus: FakeBus;
  cleanup: ReturnType<typeof vi.fn>;
  repo: ReturnType<typeof makeFakeRepo>;
}

function makeHarness(opts?: { sessionInfo?: SessionInfo }): Harness {
  const repo = makeFakeRepo(opts);
  const bus = makeFakeBus();
  const cleanup = vi.fn();
  const model = createSessionModel({
    repo,
    bus: {
      onOutput: () => () => {},
      onClosed: (h) => {
        bus.closedHandlers.push(h);
        return () => {};
      },
      onDisconnected: (h) => {
        bus.disconnectedHandlers.push(h);
        return () => {};
      },
    },
    mirror: makeFakeMirror(),
    onSessionClosed: cleanup,
  });
  return { model, bus, cleanup, repo };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SessionBridge (Phase 3)", () => {
  it("renders null", () => {
    const { model } = makeHarness();
    const { container } = render(<SessionBridge model={model} />);
    expect(container.firstChild).toBeNull();
    model.dispose();
  });

  it("invokes onSessionClosed callback when a registered session closes", async () => {
    const h = makeHarness();
    const created = await h.model.create(LOCAL_INPUT);
    h.bus.emitClosed(created.id);
    expect(h.cleanup).toHaveBeenCalledWith(created.id);
    h.model.dispose();
  });

  it("does NOT invoke onSessionClosed for unknown session ids", () => {
    const h = makeHarness();
    h.bus.emitClosed(99999);
    expect(h.cleanup).not.toHaveBeenCalled();
    h.model.dispose();
  });

  it("session-disconnected flips isConnected to false (via model)", async () => {
    const h = makeHarness();
    const created = await h.model.create(LOCAL_INPUT);
    expect(created.isConnected).toBe(true);
    h.bus.emitDisconnected(created.id);
    expect(h.model.get(created.id)?.isConnected).toBe(false);
    h.model.dispose();
  });

  it("rerenders safely without leaking subscriptions", async () => {
    const h = makeHarness();
    await h.model.create(LOCAL_INPUT);
    const { container, rerender } = render(<SessionBridge model={h.model} />);
    expect(container.firstChild).toBeNull();
    rerender(<SessionBridge model={h.model} />);
    expect(container.firstChild).toBeNull();
    h.model.dispose();
  });

  it("seeds via model.create() with custom id and surfaces id in cleanup", async () => {
    const h = makeHarness({
      sessionInfo: {
        id: 42,
        name: "named",
        sessionType: LOCAL_INPUT,
        isConnected: true,
      },
    });
    const created = await h.model.create(LOCAL_INPUT);
    expect(created.id).toBe(42);
    h.bus.emitClosed(42);
    expect(h.cleanup).toHaveBeenCalledWith(42);
    h.model.dispose();
  });
});

describe("runWorkspaceCleanupForSessions", () => {
  it("removes the matching leaf from a terminal window", () => {
    const leafA = {
      id: "pane-a",
      kind: "leaf" as const,
      size: 50,
      binding: { sessionId: 11, configId: "" },
    };
    const leafB = {
      id: "pane-b",
      kind: "leaf" as const,
      size: 50,
      binding: { sessionId: 22, configId: "" },
    };
    const splitRoot = {
      id: "split",
      kind: "split" as const,
      size: 100,
      layout: { direction: "horizontal" as const, children: [leafA, leafB] },
    };
    const window = {
      id: "win-1",
      kind: "terminal" as const,
      name: "w",
      rootPane: splitRoot,
      activePaneId: "pane-a",
    };
    useWorkspaceStore.setState({
      workspaces: [
        {
          id: "ws-1",
          name: "ws",
          windows: [window],
          activeWindowId: "win-1",
        },
      ],
      activeWorkspaceId: "ws-1",
    });

    runWorkspaceCleanupForSessions([11]);

    const next = useWorkspaceStore.getState().workspaces[0]!.windows[0]!;
    if (next.kind === "terminal") {
      // After removing session 11, leafA is unbound. Per
      // `collapseEmptySplits` semantics, the split stays as a split
      // because leafB still has a binding. We assert the unbound
      // leaf is dropped from its binding and leafB is untouched.
      expect(next.rootPane.kind).toBe("split");
      const split = next.rootPane;
      if (split.kind === "split") {
        const children = split.layout.children;
        expect(children).toHaveLength(2);
        const childA = children[0]!;
        const childB = children[1]!;
        if (childA.kind === "leaf") {
          expect(childA.binding).toBeUndefined();
        } else {
          throw new Error("expected leaf child A");
        }
        if (childB.kind === "leaf") {
          expect(childB.binding?.sessionId).toBe(22);
        } else {
          throw new Error("expected leaf child B");
        }
      }
      expect(next.activePaneId).toBe("pane-a");
    } else {
      throw new Error("expected terminal window");
    }
  });

  it("collapses a split where ALL leaves become unbound after removal", () => {
    // Both leaves point to session 11 → removing 11 leaves both
    // unbound → split collapses to a single empty leaf.
    const leafA = {
      id: "pane-a",
      kind: "leaf" as const,
      size: 50,
      binding: { sessionId: 11, configId: "" },
    };
    const leafB = {
      id: "pane-b",
      kind: "leaf" as const,
      size: 50,
      binding: { sessionId: 11, configId: "" },
    };
    const splitRoot = {
      id: "split",
      kind: "split" as const,
      size: 100,
      layout: { direction: "horizontal" as const, children: [leafA, leafB] },
    };
    const window = {
      id: "win-1",
      kind: "terminal" as const,
      name: "w",
      rootPane: splitRoot,
      activePaneId: "pane-a",
    };
    useWorkspaceStore.setState({
      workspaces: [
        {
          id: "ws-1",
          name: "ws",
          windows: [window],
          activeWindowId: "win-1",
        },
      ],
      activeWorkspaceId: "ws-1",
    });

    runWorkspaceCleanupForSessions([11]);

    const next = useWorkspaceStore.getState().workspaces[0]!.windows[0]!;
    if (next.kind === "terminal") {
      expect(next.rootPane.kind).toBe("leaf");
      const leaf = next.rootPane;
      if (leaf.kind === "leaf") {
        expect(leaf.binding).toBeUndefined();
      }
    } else {
      throw new Error("expected terminal window");
    }
  });

  it("is a no-op for an empty sessionIds list", () => {
    useWorkspaceStore.setState({
      workspaces: [],
      activeWorkspaceId: null,
    });
    runWorkspaceCleanupForSessions([]);
    expect(useSessionStore.getState().sessions).toBeDefined();
  });
});

describe("legacy useSessionStore mirror stays in sync via SessionModel", () => {
  it("the model's mirror replaces drive useSessionStore.sessions", async () => {
    const repo = makeFakeRepo({
      sessionInfo: {
        id: 7,
        name: "mirror-test",
        sessionType: LOCAL_INPUT,
        isConnected: true,
      },
    });
    useSessionStore.setState({ sessions: [] });
    const mirror: MirrorWriter = {
      replaceSessions: (sessions) => {
        useSessionStore.setState({ sessions });
      },
      updateSession: (id, patch) => {
        useSessionStore.setState((s) => ({
          sessions: s.sessions.map((row) => (row.id === id ? { ...row, ...patch } : row)),
        }));
      },
      addSession: (session) => {
        useSessionStore.setState((s) =>
          s.sessions.some((row) => row.id === session.id)
            ? s
            : { sessions: [...s.sessions, session] },
        );
      },
      removeSession: (id) => {
        useSessionStore.setState((s) => ({
          sessions: s.sessions.filter((row) => row.id !== id),
        }));
      },
      markSessionConnected: (id, isConnected) => {
        useSessionStore.setState((s) => ({
          sessions: s.sessions.map((row) => (row.id === id ? { ...row, isConnected } : row)),
        }));
      },
      beginEstablishing: () => {},
      endEstablishing: () => {},
    };
    const bus: FakeBus = makeFakeBus();
    const model = createSessionModel({
      repo,
      bus: {
        onOutput: () => () => {},
        onClosed: (h) => {
          bus.closedHandlers.push(h);
          return () => {};
        },
        onDisconnected: () => () => {},
      },
      mirror,
    });
    await model.create(LOCAL_INPUT);
    expect(useSessionStore.getState().sessions.find((s) => s.id === 7)).toBeDefined();
    model.markConnected(7, false);
    expect(useSessionStore.getState().sessions.find((s) => s.id === 7)?.isConnected).toBe(false);
    bus.emitClosed(7);
    expect(useSessionStore.getState().sessions.find((s) => s.id === 7)).toBeUndefined();
    model.dispose();
  });
});
