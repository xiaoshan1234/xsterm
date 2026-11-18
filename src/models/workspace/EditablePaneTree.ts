export type PaneSplitDirection = "horizontal" | "vertical";

/**
 * Mutable pane layout used while editing a raw workspace window.
 *
 * Backend DTOs are normalized before reaching this model. Sizes are
 * percentages within the parent split.
 */
export interface EditablePaneNode {
  id: string;
  type: "leaf" | "split";
  direction?: PaneSplitDirection;
  size: number;
  children?: EditablePaneNode[];
  terminalId?: number;
  configId?: string;
}
