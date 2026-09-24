/**
 * Smoke test for the session service store — verifies initial state shape
 * and that the simple stub actions wired in Commit 3 actually mutate the
 * store. Real action bodies land in Commit 4 (useCases).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useSessionStore } from "./store";

describe("useSessionStore", () => {
  beforeEach(() => {
    useSessionStore.getState().reset();
  });

  it("starts with empty sessions + default flags", () => {
    const state = useSessionStore.getState();
    expect(state.sessions).toEqual([]);
    expect(state.isGlobalLocalEcho).toBe(false);
    expect(state.tmuxControllerErrors.size).toBe(0);
    expect(state.sessionLocalEchoOverrides.size).toBe(0);
    expect(state.getEffectiveLocalEcho(42)).toBe(false);
  });

  it("setGlobalLocalEchoAction toggles the global flag", () => {
    useSessionStore.getState().setGlobalLocalEchoAction(true);
    expect(useSessionStore.getState().isGlobalLocalEcho).toBe(true);
    expect(useSessionStore.getState().getEffectiveLocalEcho(1)).toBe(true);
  });

  it("setSessionLocalEchoOverride overrides per-session", () => {
    useSessionStore.getState().setGlobalLocalEchoAction(false);
    useSessionStore.getState().setSessionLocalEchoOverride(7, true);
    expect(useSessionStore.getState().getEffectiveLocalEcho(7)).toBe(true);
    expect(useSessionStore.getState().getEffectiveLocalEcho(8)).toBe(false);
    // Clearing the override falls back to global.
    useSessionStore.getState().setSessionLocalEchoOverride(7, undefined);
    expect(useSessionStore.getState().getEffectiveLocalEcho(7)).toBe(false);
  });

  it("setTmuxControllerError writes and clears entries", () => {
    useSessionStore.getState().setTmuxControllerError(1, {
      config: { name: "tmux" },
      timestamp: 1234,
    });
    expect(useSessionStore.getState().tmuxControllerErrors.get(1)?.timestamp).toBe(1234);
    useSessionStore.getState().setTmuxControllerError(1, undefined);
    expect(useSessionStore.getState().tmuxControllerErrors.has(1)).toBe(false);
  });

  it("rememberTmuxControllerConfig / forgetTmuxControllerConfig manipulate the ref-backed map", () => {
    useSessionStore.getState().rememberTmuxControllerConfig(2, { name: "cfg" });
    expect(useSessionStore.getState().tmuxControllerConfigsRef.current.get(2)?.name).toBe("cfg");
    useSessionStore.getState().forgetTmuxControllerConfig(2);
    expect(useSessionStore.getState().tmuxControllerConfigsRef.current.has(2)).toBe(false);
  });
});
