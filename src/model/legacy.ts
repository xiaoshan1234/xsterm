/**
 * Compatibility shim — the old `Session` shape carried a `sessionType`
 * field as a discriminated union (`{ type, config }`). The refactor
 * moved transport info to the new `SessionType` literal type
 * (`"local" | "ssh" | "tmux-cc"`) and moved config objects to a
 * separate `CreateSessionInput` union (used only at creation time).
 *
 * Code paths that still construct legacy `sessionType: { type, config }`
 * literals can wrap with `legacySessionType(...)` so the type checker
 * accepts them while consumers migrate. Returns the legacy union for
 * any string `type` and any config object — intentionally permissive.
 */
import type { Session } from "./session";

/** @deprecated Use `CreateSessionInput` for new configs. */
export type LegacySessionType =
  | { type: "local"; config: object }
  | { type: "ssh"; config: object }
  | { type: "tmux-cc"; config: object };

/**
 * Casts a free-form `{ type, config }` object to the legacy
 * `SessionType` union for backwards-compat with existing call-sites.
 * New code should not use this.
 * @deprecated
 */
export function legacySessionType(value: {
  type: string;
  config: object;
}): Session["sessionType"] {
  return value as unknown as Session["sessionType"];
}
