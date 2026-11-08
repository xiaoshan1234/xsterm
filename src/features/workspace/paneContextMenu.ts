import type { ContextMenuItem } from "../../shared/ui/ContextMenu";
import type { Terminal, SplitDirection, Window } from "../../types/terminal";

export interface PaneMenuActions {
  startSplit: (direction: SplitDirection) => void;
  startAttach: () => void;
  selectAll: () => void;
  copy: () => Promise<void>;
  paste: () => Promise<void>;
  clear: () => void;
  closePane: () => void;
  closeTerminal: () => void;
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
 *  - If no terminal attached: Attach Terminal
 *  - If terminal attached: Select All, Copy, (Paste if connected), Clear Pane
 *  - Always: Close Pane (danger)
 *  - If terminal attached: Close Terminal (danger)
 *  - tmux terminal: New Tmux Window, Rename Tmux Window, Close Tmux Window
 */
export function buildPaneContextMenu(
  terminal: Terminal | undefined,
  actions: PaneMenuActions,
  containingWindow?: Window,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    { label: "Split Horizontal", onClick: () => actions.startSplit("horizontal") },
    { label: "Split Vertical", onClick: () => actions.startSplit("vertical") },
  ];

  if (!terminal) {
    items.push({ label: "Attach Terminal", onClick: actions.startAttach });
  }

  if (terminal) {
    items.push(
      { label: "Select All", onClick: actions.selectAll },
      { label: "Copy", onClick: actions.copy },
    );
    if (terminal.isConnected) {
      items.push({ label: "Paste", onClick: actions.paste });
    }
    items.push({ label: "Clear Pane", onClick: actions.clear });
  }

  // tmux window management (only when the terminal is a tmux pane
  // and the optional tmux handlers are provided by the caller).
  const isTmux = terminal?.type === "tmux-pane";
  const hasTmuxWindowId = containingWindow?.xstermWindowId !== undefined;
  if (isTmux) {
    if (actions.createTmuxWindow) {
      items.push({ label: "New Tmux Window", onClick: actions.createTmuxWindow });
    }
    if (actions.renameTmuxWindow) {
      items.push({ label: "Rename Tmux Window…", onClick: actions.renameTmuxWindow });
    }
    if (actions.killTmuxWindow && hasTmuxWindowId) {
      items.push({
        label: "Close Tmux Window",
        onClick: actions.killTmuxWindow,
        danger: true,
      });
    }
  }

  items.push({ label: "Close Pane", onClick: actions.closePane, danger: true });

  if (terminal) {
    items.push({ label: "Close Terminal", onClick: actions.closeTerminal, danger: true });
  }

  return items;
}
