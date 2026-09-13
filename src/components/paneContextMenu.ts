import type { ContextMenuItem } from "./ui/ContextMenu";
import type { Session, SplitDirection, Window } from "../types/session";

export interface PaneMenuActions {
  startSplit: (direction: SplitDirection) => void;
  startAttach: () => void;
  selectAll: () => void;
  copy: () => Promise<void>;
  paste: () => Promise<void>;
  clear: () => void;
  closePane: () => void;
  closeSession: () => void;
  /** create a new tmux window on the pane's controller. */
  createTmuxWindow?: () => void;
  /**
   * kill the pane's tmux window. Only enabled when the
   * containing Window has a known `xstermWindowId` (i.e. it was
   * created via `create_tmux_window`, not the bootstrap window).
   */
  killTmuxWindow?: () => void;
  /** rename the pane's tmux window. */
  renameTmuxWindow?: () => void;
}

/**
 * Builds the context menu items for a pane.
 *
 * Layout:
 *  - Always: Split Horizontal, Split Vertical
 *  - If no session attached: Attach Session
 *  - If session attached: Select All, Copy, (Paste if connected), Clear Pane
 *  - Always: Close Pane (danger)
 *  - If session attached: Close Session (danger)
 *  - tmux session: New Tmux Window, Rename Tmux Window,
 *    Delete from tmux server
 */
export function buildPaneContextMenu(
  session: Session | undefined,
  actions: PaneMenuActions,
  containingWindow?: Window,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    { label: "Split Horizontal", onClick: () => actions.startSplit("horizontal") },
    { label: "Split Vertical", onClick: () => actions.startSplit("vertical") },
  ];

  if (!session) {
    items.push({ label: "Attach Session", onClick: actions.startAttach });
  }

  if (session) {
    items.push(
      { label: "Select All", onClick: actions.selectAll },
      { label: "Copy", onClick: actions.copy },
    );
    if (session.isConnected) {
      items.push({ label: "Paste", onClick: actions.paste });
    }
    items.push({ label: "Clear Pane", onClick: actions.clear });
  }

  // tmux window management (only when the session is a tmux pane
  // and the optional tmux handlers are provided by the caller).
  const isTmux = session?.type === "tmux-cc";
  const hasTmuxWindowId = containingWindow?.xstermWindowId !== undefined;
  if (isTmux) {
    if (actions.createTmuxWindow) {
      items.push({ label: "New Tmux Window", onClick: actions.createTmuxWindow });
    }
    if (actions.renameTmuxWindow) {
      items.push({ label: "Rename Tmux Window…", onClick: actions.renameTmuxWindow });
    }
    if (actions.killTmuxWindow && hasTmuxWindowId) {
      // ADR 0009 §2.10: rename "Close Tmux Window" → "Delete from
      // tmux server" so the destructive nature of kill-window is
      // explicit. The user can still detach (i.e. close the
      // underlying session) via the standard "Close Session" item.
      items.push({
        label: "Delete from tmux server",
        onClick: actions.killTmuxWindow,
        danger: true,
      });
    }
  }

  items.push({ label: "Close Pane", onClick: actions.closePane, danger: true });

  if (session) {
    items.push({ label: "Close Session", onClick: actions.closeSession, danger: true });
  }

  return items;
}
