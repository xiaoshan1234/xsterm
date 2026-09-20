/**
 * Backend-side metadata for tmux-attached sessions.
 *
 * The fields are kept flat on `Session` itself (see `./session.ts`) so
 * that IPC client wrappers can read them directly without dereferencing
 * a nested object — the only thing that survives here is the boolean
 * bootstrap-pane marker.
 *
 * History: an earlier shape carried two `Map<number, string>` lookups
 * (`xsWindowToTmuxWindow`, `xsPaneToTmuxPane`) used to translate
 * backend-allocated u32 ids into tmux server-side string ids before
 * invoking `kill_tmux_window` / `kill_tmux_pane` / etc. Rust IPC
 * commands now take the tmux-side identifiers directly, so the
 * translation lives on the backend and the maps were deleted.
 */

/**
 * Bootstrap-pane marker attached to a `Session` of type `"tmux-cc"`.
 *
 * `true` for the very first pane a controller registers (the pane that
 * spawned the xsterm Window the bootstrap pane lives in) — the UI
 * renders nothing for it. Splits driven by the user (`create_tmux_pane`)
 * are NOT hidden and produce a normal leaf.
 *
 * Most callers do not need this shape directly; `Session.isHidden?`
 * carries the boolean. The interface is kept for documentation and as
 * a hook for any future per-session backend state that needs grouping.
 */
export interface TmuxSessionBackend {
  /** `true` for the bootstrap pane; UI renders nothing for it. */
  isHidden?: boolean;
}
