/**
 * applyDisplayConfigToLiveSession — patch a runtime session's
 * `displayConfig` so the new values propagate via React to Terminal.
 * Persistence is the caller's responsibility.
 */
import { useSessionStore } from "../../service/session/store";
import type { SessionDisplayConfig } from "../../model/entities";

export function applyDisplayConfigToLiveSession(
  id: number,
  patch: Partial<SessionDisplayConfig>,
): void {
  useSessionStore
    .getState()
    .setSessions((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, displayConfig: { ...(s.displayConfig ?? {}), ...patch } } : s,
      ),
    );
}
