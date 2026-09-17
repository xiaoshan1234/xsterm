/**
 * @vitest-environment jsdom
 *
 * Smoke test for the SessionBridge — verifies the component renders
 * without error and that the useEffect subscription wiring runs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { SessionBridge } from "./sessionBridge";
import { useSessionStore } from "../session/store";

const subscribers = new Map<string, Set<(payload: unknown) => void>>();

vi.mock("../../infra/tauri/eventBus", () => ({
  infraEventBus: {
    subscribe<T>(eventName: string, handler: (payload: T) => void): () => void {
      let set = subscribers.get(eventName);
      if (!set) {
        set = new Set();
        subscribers.set(eventName, set);
      }
      set.add(handler as (payload: unknown) => void);
      return () => {
        set!.delete(handler as (payload: unknown) => void);
      };
    },
  },
}));

const TEST_SESSION = {
  id: 999,
  configId: "",
  name: "test",
  type: "local" as const,
  isConnected: true,
  sessionType: { type: "local" as const, config: { name: "test" } },
  createdAt: Date.now(),
};

describe("SessionBridge", () => {
  beforeEach(() => {
    subscribers.clear();
    useSessionStore.setState((prev) => ({ sessions: [...prev.sessions, TEST_SESSION] }));
  });

  afterEach(() => {
    subscribers.clear();
    useSessionStore.setState((prev) => ({
      sessions: prev.sessions.filter((s) => s.id !== TEST_SESSION.id),
    }));
  });

  it("renders null and subscribes to session-closed and session-disconnected only", () => {
    const { container } = render(<SessionBridge />);
    expect(container.firstChild).toBeNull();

    expect(subscribers.get("session-closed")?.size).toBe(1);
    expect(subscribers.get("session-disconnected")?.size).toBe(1);
    expect(subscribers.get("session-output")?.size ?? 0).toBe(0);
  });

  it("unsubscribes on unmount", () => {
    const { unmount } = render(<SessionBridge />);
    expect(subscribers.get("session-closed")?.size).toBe(1);
    expect(subscribers.get("session-disconnected")?.size).toBe(1);
    unmount();
    expect(subscribers.get("session-closed")?.size ?? 0).toBe(0);
    expect(subscribers.get("session-disconnected")?.size ?? 0).toBe(0);
  });

  it("session-disconnected flips isConnected to false", () => {
    render(<SessionBridge />);
    const handler = subscribers.get("session-disconnected")?.values().next().value as (
      payload: unknown,
    ) => void;
    handler(TEST_SESSION.id);
    expect(
      useSessionStore.getState().sessions.find((s) => s.id === TEST_SESSION.id)?.isConnected,
    ).toBe(false);
  });

  it("session-closed removes the session row", () => {
    render(<SessionBridge />);
    const handler = subscribers.get("session-closed")?.values().next().value as (
      payload: unknown,
    ) => void;
    handler(TEST_SESSION.id);
    expect(
      useSessionStore.getState().sessions.find((s) => s.id === TEST_SESSION.id),
    ).toBeUndefined();
  });
});
