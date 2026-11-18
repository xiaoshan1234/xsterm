import {
  subscribeTerminalOutput,
  terminalCommands,
  toBackendTerminalHandle,
} from "../infrastructure";

export const terminalStreamActions = {
  async writeBytes(terminalId: number, data: Uint8Array): Promise<void> {
    await terminalCommands.writeTerminal(toBackendTerminalHandle(terminalId), data);
  },

  async subscribeOutput(
    terminalId: number,
    onOutput: (data: Uint8Array) => void,
  ): Promise<() => void> {
    return subscribeTerminalOutput(terminalId, onOutput);
  },
};
