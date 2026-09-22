/**
 * Legacy redirect for `CapabilityFlags`. Older code paths imported from
 * `model/capabilities` after the per-transport config shapes migrated
 * to `model/session.ts`. The canonical definition lives in
 * `model/session.ts` next to `Session`.
 */
export type { CapabilityFlags } from "./session";
