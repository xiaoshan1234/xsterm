import type { LocalTerminalConfig, SshConfig } from "../contracts";
import { terminalCommands, type TerminalLoggingConfigDto } from "../infrastructure";
import { type TerminalConnectionInfo } from "../contracts";
import { toTerminalConnectionInfo } from "./terminalConnection";

export const terminalSessionActions = {
  async createLocal(
    config: LocalTerminalConfig,
    logging?: TerminalLoggingConfigDto,
  ): Promise<TerminalConnectionInfo> {
    return toTerminalConnectionInfo(await terminalCommands.createLocalTerminal(config, logging));
  },

  async createSsh(
    config: SshConfig,
    logging?: TerminalLoggingConfigDto,
  ): Promise<TerminalConnectionInfo> {
    return toTerminalConnectionInfo(await terminalCommands.createSshTerminal(config, logging));
  },

  async closeTerminal(terminalId: number): Promise<void> {
    await terminalCommands.closeTerminal(terminalId);
  },

  async resizeTerminal(terminalId: number, rows: number, cols: number): Promise<void> {
    await terminalCommands.resizeTerminal(terminalId, rows, cols);
  },

  async uploadImageToSshTerminal(
    terminalId: number,
    filename: string,
    data: Uint8Array,
  ): Promise<string> {
    return terminalCommands.uploadImageToSshTerminal(terminalId, filename, data);
  },
};
