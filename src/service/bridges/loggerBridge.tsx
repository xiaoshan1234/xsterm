/**
 * Logger bridge — keeps the legacy `LoggerContext` /
 * `useLogger()` consumers routed to the infra `logger.ts`
 * singleton, and mirrors log-level config changes into the
 * logger store.
 *
 * **Skeleton in Commit 3**: just subscribes the legacy
 * context to the store's effective level. Commit 4 wires the
 * settings.json read/write side-effects.
 *
 * **Render**: returns `null`. Mount once at the top of the
 * React tree.
 */
import { useEffect } from "react";
import { useLoggerStore } from "../logger/store";

export function LoggerBridge(): null {
  const level = useLoggerStore((s) => s.effectiveLevel);

  useEffect(() => {
    // Future: forward `level` into a logger-store-driven
    // filter in infra/logger/logger.ts. For now just acknowledge.
    void level;
  }, [level]);

  return null;
}
