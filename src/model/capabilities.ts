/**
 * Legacy re-export shim — `CapabilityFlags` moved to
 * `model/session/types.ts`. Kept so existing imports of
 * `model/capabilities` keep resolving.
 */
export type { CapabilityFlags } from "./session/index";
