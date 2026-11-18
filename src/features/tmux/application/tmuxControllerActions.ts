import type { SplitDirection } from "../../../models/runtime/pane";
import type { TmuxSessionConfig } from "../../../models/runtime/tmux";
import {
  toBackendTerminalHandle,
  toTerminalConnectionInfo,
  type TerminalConnectionInfo,
} from "../../terminal-stream";
import { tmuxCommands, toBackendControllerHandle } from "../infrastructure";

export const tmuxControllerActions = {
  async createSession(config: TmuxSessionConfig): Promise<TerminalConnectionInfo> {
    return toTerminalConnectionInfo(await tmuxCommands.createTmuxSession(config));
  },

  async attachSession(config: TmuxSessionConfig): Promise<TerminalConnectionInfo> {
    return toTerminalConnectionInfo(await tmuxCommands.attachTmuxSession(config));
  },

  async detachSession(controllerId: number): Promise<void> {
    await tmuxCommands.detachTmuxSession(toBackendControllerHandle(controllerId));
  },

  async createPane(
    controllerId: number,
    parentTerminalId: number,
    direction: SplitDirection,
  ): Promise<TerminalConnectionInfo> {
    return toTerminalConnectionInfo(
      await tmuxCommands.createTmuxPane(
        toBackendControllerHandle(controllerId),
        toBackendTerminalHandle(parentTerminalId),
        direction,
      ),
    );
  },

  async killPane(terminalId: number): Promise<void> {
    await tmuxCommands.killTmuxPane(toBackendTerminalHandle(terminalId));
  },

  async resizeWindow(controllerId: number, cols: number, rows: number): Promise<void> {
    await tmuxCommands.resizeTmuxWindow(toBackendControllerHandle(controllerId), cols, rows);
  },

  async capturePane(terminalId: number, lines: number): Promise<string> {
    return tmuxCommands.captureTmuxPane(toBackendTerminalHandle(terminalId), lines);
  },
};
