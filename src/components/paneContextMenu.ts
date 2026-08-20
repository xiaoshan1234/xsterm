import type { ContextMenuItem } from "./ui/ContextMenu";
import type { Session, SplitDirection } from "../types/session";

export interface PaneMenuActions {
  startSplit: (direction: SplitDirection) => void;
  startAttach: () => void;
  selectAll: () => void;
  copy: () => Promise<void>;
  paste: () => Promise<void>;
  clear: () => void;
  closePane: () => void;
  closeSession: () => void;
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
 */
export function buildPaneContextMenu(
  session: Session | undefined,
  actions: PaneMenuActions,
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

  items.push({ label: "Close Pane", onClick: actions.closePane, danger: true });

  if (session) {
    items.push({ label: "Close Session", onClick: actions.closeSession, danger: true });
  }

  return items;
}
