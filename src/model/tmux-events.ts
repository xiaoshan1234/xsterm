/**
 * Legacy re-export shim — types moved to `model/tmux/types.ts`.
 *
 * The path uses the explicit `/index` suffix because TS would
 * otherwise resolve `./tmux` to this very file (the directory
 * `./tmux/` and the file `./tmux-events.ts` are co-located here,
 * and `./tmux` matches the sibling directory).
 */
export type {
  TmuxControllerExitEvent,
  TmuxPaneAddedEvent,
  TmuxPaneRemovedEvent,
  TmuxWindowAddedEvent,
  TmuxWindowClosedEvent,
  TmuxWindowListEntry,
  TmuxWindowListRawEvent,
  TmuxWindowRenamedEvent,
  TmuxControllerError,
  TmuxAttachmentRecord,
} from "./tmux/index";
