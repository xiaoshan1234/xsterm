import { subscribeTerminalOutput, terminalCommands } from "../infrastructure";

export const terminalStreamActions = {
  async writeBytes(terminalId: number, data: Uint8Array): Promise<void> {
    await terminalCommands.writeTerminal(terminalId, data);
  },

  async subscribeOutput(
    terminalId: number,
    onOutput: (data: Uint8Array) => void,
  ): Promise<() => void> {
    return subscribeTerminalOutput(terminalId, onOutput);
  },
};
