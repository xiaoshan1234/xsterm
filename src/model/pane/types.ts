/**
 * Pane tree schema.
 *
 * A pane tree lives inside a `Window`. The tree has two node kinds,
 * distinguished by the `kind` discriminator:
 * - `"split"`: a divider holding a `SplitLayout` (direction + children)
 * - `"leaf"`:  a terminal pane bound to an optional `PaneBinding`
 *
 * `size` is the node's fractional share of its parent split. Splits
 * don't carry a `size` themselves — each leaf's `size` is relative to
 * the surrounding split (a leaf at the root uses 1).
 */

/** Direction of a split divider. `"horizontal"` = divider is horizontal, panes stacked top↔bottom. */
export type SplitDirection = "horizontal" | "vertical";

/** Fractional share of a parent split, normalised against sibling sizes. */
export type PaneSize = number;

/**
 * Binding of a leaf pane to a backend session. A pane without a binding
 * is an init placeholder — rendered as a hint to attach a session.
 */
export interface PaneBinding {
  /** Backend session id (`useSessionStore.sessions[]`). */
  sessionId: number;
  /** Saved config id the session was opened from. Empty string for ad-hoc sessions. */
  configId: string;
}

/**
 * Layout of a split node: how its children are arranged.
 * Children are stored in display order.
 */
export interface SplitLayout {
  direction: SplitDirection;
  children: PaneNode[];
}

/**
 * Discriminated union of pane nodes.
 *
 * - `PaneSplitNode`: a divider that holds a `SplitLayout`.
 * - `PaneLeafNode`:  a terminal pane bound to an optional `PaneBinding`.
 *
 * Common fields: `id` (stable pane id, frontend-local), `kind`
 * (discriminator), `size` (share of the parent split).
 */
export type PaneNode = PaneSplitNode | PaneLeafNode;

export interface PaneSplitNode {
  id: string;
  kind: "split";
  size: PaneSize;
  layout: SplitLayout;
}

export interface PaneLeafNode {
  id: string;
  kind: "leaf";
  size: PaneSize;
  /** Undefined for an init placeholder pane. */
  binding?: PaneBinding;
}

// ---------------------------------------------------------------------------
// Persisted pane trees — mirror the runtime discriminated union but
// without the runtime-only `binding.sessionId`. The frontend reads
// `configId` at restore time and resolves it to a fresh session.

/**
 * Frozen pane tree stored in `PersistedWindowConfig`. Mirrors the runtime
 * discriminated union but without the runtime `binding.sessionId` —
 * persisted configs only carry `configId` so the runtime can resolve
 * to a fresh session on reload.
 */
export type PersistedPaneNode = PaneSavedSplitNode | PaneSavedLeafNode;

export interface PaneSavedSplitNode {
  id: string;
  kind: "split";
  size: number;
  layout: SplitLayout;
}

export interface PaneSavedLeafNode {
  id: string;
  kind: "leaf";
  size: number;
  /** Undefined for an init placeholder pane. */
  binding?: { configId: string };
}
