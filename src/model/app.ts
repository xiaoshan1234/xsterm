/**
 * App-wide identity.
 *
 * `App` is the singleton root of the frontend state tree: a list of
 * `Workspace`s plus the active selection. It is independent of any
 * single `Workspace` — the user always has exactly one `App`, but a
 * `Workspace` may be created and not yet attached.
 *
 * Lives in its own file (not bundled with `workspace.ts`) because it
 * describes a different scope: top-level application identity vs. one
 * tabbed workspace.
 */

/** The frontend's top-level state tree. */
export interface App {
  workspaces: import("./workspace").Workspace[];
  activeWorkspaceId: string | null;
}
