/**
 * Session domain barrel.
 *
 * Re-exports all session-related types, helpers, and access interfaces.
 * Consumers should import from `../../model/session` (or via the top
 * `../../model` barrel) rather than reaching into individual files.
 *
 * Uses `export *` instead of explicit named re-exports so the top-level
 * `../../model` barrel can forward every named export (including types)
 * via `export *`. With `isolatedModules: true`, explicit
 * `export type { ... }` chains can swallow types under the wildcard
 * re-export.
 */
export * from "./types";
export * from "./accessor";
export * from "./repository";
export * from "./events";
export * from "./model";
