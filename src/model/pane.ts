/**
 * Legacy re-export shim — types moved to `model/pane/types.ts`.
 *
 * The path uses the explicit `/index` suffix because TS would
 * otherwise resolve `./pane` to this very file (the directory
 * `./pane/` and the file `./pane.ts` both exist here).
 */
export type {
  PaneBinding,
  PaneLeafNode,
  PaneNode,
  PaneSavedLeafNode,
  PaneSavedSplitNode,
  PaneSize,
  PaneSplitNode,
  SavedPaneNode,
  SplitDirection,
  SplitLayout,
} from "./pane/index";
