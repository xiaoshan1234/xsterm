import type { PaneSplitDirection } from "../../../features/workspace";
import type { TmuxSessionConfig } from "../../../features/launch-config";
import { toTerminalConnectionInfo, type TerminalConnectionInfo } from "../../terminal-stream";
import { tmuxCommands } from "../infrastructure";

export const tmuxControllerActions = {
  async createSession(config: TmuxSessionConfig): Promise<TerminalConnectionInfo> {
    return toTerminalConnectionInfo(await tmuxCommands.createTmuxSession(config));
  },

  async attachSession(config: TmuxSessionConfig): Promise<TerminalConnectionInfo> {
    return toTerminalConnectionInfo(await tmuxCommands.attachTmuxSession(config));
  },

  async detachSession(controllerId: number): Promise<void> {
    await tmuxCommands.detachTmuxSession(controllerId);
  },

  async createPane(
    controllerId: number,
    parentTerminalId: number,
    direction: PaneSplitDirection,
  ): Promise<TerminalConnectionInfo> {
    return toTerminalConnectionInfo(
      await tmuxCommands.createTmuxPane(controllerId, parentTerminalId, direction),
    );
  },

  async killPane(terminalId: number): Promise<void> {
    await tmuxCommands.killTmuxPane(terminalId);
  },

  async resizeWindow(controllerId: number, cols: number, rows: number): Promise<void> {
    await tmuxCommands.resizeTmuxWindow(controllerId, cols, rows);
  },

  async capturePane(terminalId: number, lines: number): Promise<string> {
    return tmuxCommands.captureTmuxPane(terminalId, lines);
  },
};
