/**
 * Legacy re-export shim — types moved to `model/tmux/types.ts`.
 *
 * The path uses the explicit `/index` suffix because TS would
 * otherwise resolve `./tmux` to this very file (the directory
 * `./tmux/` and the file `./tmux.ts` both exist here).
 */
export type {
  TmuxAttachmentRecord,
  AutoAttachOutcome,
  TmuxControllerError,
  TmuxControllerExitEvent,
  TmuxControlWindowInit,
  TmuxPaneAddedEvent,
  TmuxPaneInit,
  TmuxPaneRemovedEvent,
  TmuxSessionBackend,
  TmuxSessionInit,
  TmuxWindowAddedEvent,
  TmuxWindowClosedEvent,
  TmuxWindowInit,
  TmuxWindowListEntry,
  TmuxWindowListRawEvent,
  TmuxWindowRenamedEvent,
} from "./tmux/index";
