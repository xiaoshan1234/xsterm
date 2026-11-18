import { type TmuxSessionConfig } from "../../../models/runtime/terminal";
import { toBackendTerminalHandle } from "../../terminal/infrastructure/handles";
import { tmuxCommands, toBackendControllerHandle } from "../infrastructure";

export const tmuxControllerActions = {
  async attachSession(config: TmuxSessionConfig): Promise<void> {
    await tmuxCommands.attachTmuxSession(config);
  },

  async resizeWindow(controllerId: number, cols: number, rows: number): Promise<void> {
    await tmuxCommands.resizeTmuxWindow(toBackendControllerHandle(controllerId), cols, rows);
  },

  async capturePane(terminalId: number, lines: number): Promise<string> {
    return tmuxCommands.captureTmuxPane(toBackendTerminalHandle(terminalId), lines);
  },
};
