import type { TerminalId } from "../../../models";
import { subscribeTerminalOutput, terminalCommands } from "../infrastructure";

export const terminalStreamActions = {
  async writeBytes(terminalId: TerminalId, data: Uint8Array): Promise<void> {
    await terminalCommands.writeTerminal(terminalId, data);
  },

  async subscribeOutput(
    terminalId: TerminalId,
    onOutput: (data: Uint8Array) => void,
  ): Promise<() => void> {
    return subscribeTerminalOutput(terminalId, onOutput);
  },
};
