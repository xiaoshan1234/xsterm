import { type Terminal, type Workspace } from "../../models/legacy/terminal";
import { type TmuxStatusControllerViewData } from "../../features/tmux/viewModels/statusViewModel";
import { findPaneNode, getLeafPaneIds } from "../../shared/utils/paneTreeUtils";

export type RuntimeStatusTransport = "local" | "ssh" | "wsl";

export interface RuntimeStatusViewData {
  terminalId: number;
  status: "connected" | "disconnected";
  name: string;
  kind: string;
  detail?: string;
  size?: { cols: number; rows: number };
  paneNumber?: number;
  paneCount: number;
}

export function selectRuntimeStatus(
  activeWorkspace: Workspace | null,
  terminals: readonly Terminal[],
  tmuxControllers: readonly TmuxStatusControllerViewData[],
  terminalSizes: ReadonlyMap<number, { rows: number; cols: number }>,
): RuntimeStatusViewData | null {
  if (!activeWorkspace) return null;

  const activeWindow =
    activeWorkspace.windows.find((window) => window.id === activeWorkspace.activeWindowId) ??
    activeWorkspace.windows[0];
  if (!activeWindow?.activePaneId) return null;

  const activePane = findPaneNode(activeWindow.rootPane, activeWindow.activePaneId);
  if (activePane?.type !== "leaf" || activePane.terminalId === undefined) return null;

  const terminal = terminals.find((candidate) => candidate.id === activePane.terminalId);
  if (!terminal) return null;

  const paneIds = getLeafPaneIds(activeWindow.rootPane);
  const paneCount = paneIds.length;
  const paneIndex = paneIds.indexOf(activePane.id);
  const paneNumber = paneIndex >= 0 ? paneIndex + 1 : undefined;
  const measuredSize = terminalSizes.get(terminal.id);
  const size =
    measuredSize ??
    (terminal.tmuxPaneWidth !== undefined && terminal.tmuxPaneHeight !== undefined
      ? { cols: terminal.tmuxPaneWidth, rows: terminal.tmuxPaneHeight }
      : undefined);
  if (terminal.type === "tmux-pane") {
    const controller = tmuxControllers.find((candidate) =>
      candidate.windows.some((window) =>
        window.panes.some((pane) => pane.terminalId === terminal.id),
      ),
    );
    const tmuxWindow = controller?.windows.find((window) =>
      window.panes.some((pane) => pane.terminalId === terminal.id),
    );
    const tmuxPane = tmuxWindow?.panes.find((pane) => pane.terminalId === terminal.id);

    return {
      terminalId: terminal.id,
      status: tmuxPane?.status ?? (terminal.isConnected ? "connected" : "disconnected"),
      name: tmuxPane?.currentCommand ?? terminal.tmuxPaneCommand ?? terminal.name,
      kind: `${transportLabel(controller?.transport ?? "local")} tmux`,
      detail: [
        controller?.sessionName ?? controller?.title ?? terminal.tmuxSessionName ?? "session",
        tmuxWindow?.name ?? terminal.tmuxWindowName ?? terminal.tmuxWindowId ?? "window",
        terminal.tmuxPaneId ?? "pane",
      ].join(" / "),
      ...(size ? { size } : {}),
      ...(paneNumber !== undefined ? { paneNumber } : {}),
      paneCount,
    };
  }

  const detailParts: string[] = [];
  if (terminal.kind.type === "ssh") {
    detailParts.push(`${terminal.kind.user}@${terminal.kind.host}`);
  } else if (terminal.kind.type === "local") {
    detailParts.push(shellName(terminal.kind.shell));
  } else if (terminal.kind.type === "wsl") {
    detailParts.push(terminal.kind.distribution ?? "WSL");
  }
  detailParts.push(activeWindow.name);

  return {
    terminalId: terminal.id,
    status: terminal.isConnected ? "connected" : "disconnected",
    name: terminal.name,
    kind: transportLabel(terminal.type),
    detail: detailParts.filter(Boolean).join(" / "),
    ...(size ? { size } : {}),
    ...(paneNumber !== undefined ? { paneNumber } : {}),
    paneCount,
  };
}

function transportLabel(transport: RuntimeStatusTransport): string {
  if (transport === "ssh") return "SSH";
  if (transport === "wsl") return "WSL";
  return "Local";
}

function shellName(shell: string): string {
  const parts = shell.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? shell;
}
