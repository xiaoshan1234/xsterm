/**
 * @vitest-environment jsdom
 *
 * Smoke test for the SessionBridge — verifies the component renders
 * without error and that the useEffect subscription wiring runs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { SessionBridge } from "./sessionBridge";

// Replace the infra event bus with an in-test stub so the bridge
// can subscribe without reaching into Tauri internals.
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

describe("SessionBridge", () => {
  beforeEach(() => {
    subscribers.clear();
  });

  afterEach(() => {
    subscribers.clear();
  });

  it("renders null and subscribes to session-output, session-closed, session-disconnected", () => {
    const { container } = render(<SessionBridge />);
    expect(container.firstChild).toBeNull();

    expect(subscribers.get("session-output")?.size).toBe(1);
    expect(subscribers.get("session-closed")?.size).toBe(1);
    expect(subscribers.get("session-disconnected")?.size).toBe(1);
  });

  it("unsubscribes on unmount", () => {
    const { unmount } = render(<SessionBridge />);
    expect(subscribers.get("session-output")?.size).toBe(1);
    unmount();
    expect(subscribers.get("session-output")?.size ?? 0).toBe(0);
    expect(subscribers.get("session-closed")?.size ?? 0).toBe(0);
    expect(subscribers.get("session-disconnected")?.size ?? 0).toBe(0);
  });
});
