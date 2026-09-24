/**
 * Top-level model barrel.
 *
 * **Layout**: each domain lives in its own subdirectory
 * (`session/`, `workspace/`, `window/`, `pane/`, `tmux/`,
 * `persistence/`, `output/`, `theme/`) and exposes a four-piece
 * surface: `types.ts` (pure data shapes), `repository.ts`
 * (backend-side access contract), `events.ts` (event bus contract;
 * session/tmux only), `accessor.ts` (pure derived helpers; session
 * only). Each domain re-exports through `index.ts`; this file
 * aggregates all of them.
 *
 * **Backward compat**: legacy top-level files (`session.ts`,
 * `session-config.ts`, `pane.ts`, `window.ts`, `workspace.ts`,
 * `workspace-config.ts`, `window-config.ts`, `tmux.ts`,
 * `tmux-events.ts`, `tmux-init.ts`, `persistence.ts`, `theme.ts`,
 * `session-output.ts`, `app.ts`, `capabilities.ts`) are preserved as
 * re-export shims so existing consumers keep working.
 *
 * **Out of scope** here: the active `SessionModel` /
 * `PersistenceModel` etc. class files land in Phase 3. Phase 1+2 lay
 * only the type and contract surface.
 */
export * from "./session/index";
export * from "./workspace/index";
export * from "./window/index";
export * from "./pane/index";
export * from "./persistence/index";
export * from "./tmux/index";
export * from "./output/index";
export * from "./theme/index";
