import { invoke } from "@tauri-apps/api/core";
import { toBackendTerminalHandle, type BackendTerminalHandle } from "./handles";
import {
  type LocalTerminalConfigDto,
  type SshConfigDto,
  type TerminalInfoDto,
  type TerminalLoggingConfigDto,
} from "./tauriContracts";

type InvokeFunction = <Value>(command: string, args?: Record<string, unknown>) => Promise<Value>;

export interface TerminalCommandClient {
  listTerminals(): Promise<TerminalInfoDto[]>;
  createLocalTerminal(
    config: LocalTerminalConfigDto,
    logging?: TerminalLoggingConfigDto,
  ): Promise<TerminalInfoDto>;
  createSshTerminal(
    config: SshConfigDto,
    logging?: TerminalLoggingConfigDto,
  ): Promise<TerminalInfoDto>;
  writeTerminal(terminalHandle: BackendTerminalHandle, data: Uint8Array): Promise<void>;
  resizeTerminal(terminalHandle: BackendTerminalHandle, rows: number, cols: number): Promise<void>;
  closeTerminal(terminalHandle: BackendTerminalHandle): Promise<void>;
  uploadImageToSshTerminal(
    terminalHandle: BackendTerminalHandle,
    filename: string,
    data: Uint8Array,
  ): Promise<string>;
}

export function createTerminalCommandClient(
  invokeFunction: InvokeFunction = defaultInvoke,
): TerminalCommandClient {
  const writeQueues = new Map<BackendTerminalHandle, Promise<void>>();

  return {
    async listTerminals(): Promise<TerminalInfoDto[]> {
      const terminals = await invokeFunction<TerminalInfoDto[]>("list_terminals");
      return terminals.map(normalizeTerminalInfo);
    },

    async createLocalTerminal(
      config: LocalTerminalConfigDto,
      logging?: TerminalLoggingConfigDto,
    ): Promise<TerminalInfoDto> {
      const terminal = await invokeFunction<TerminalInfoDto>("create_local_terminal", {
        config,
        logging,
      });
      return normalizeTerminalInfo(terminal);
    },

    async createSshTerminal(
      config: SshConfigDto,
      logging?: TerminalLoggingConfigDto,
    ): Promise<TerminalInfoDto> {
      const terminal = await invokeFunction<TerminalInfoDto>("create_ssh_terminal", {
        config,
        logging,
      });
      return normalizeTerminalInfo(terminal);
    },

    async writeTerminal(terminalHandle: BackendTerminalHandle, data: Uint8Array): Promise<void> {
      const previous = writeQueues.get(terminalHandle) ?? Promise.resolve();
      const operation = previous
        .catch(() => undefined)
        .then(() =>
          invokeFunction<void>("write_terminal", {
            sessionId: terminalHandle,
            data,
          }),
        );
      writeQueues.set(terminalHandle, operation);
      void operation.then(
        () => {
          if (writeQueues.get(terminalHandle) === operation) {
            writeQueues.delete(terminalHandle);
          }
        },
        () => {
          if (writeQueues.get(terminalHandle) === operation) {
            writeQueues.delete(terminalHandle);
          }
        },
      );
      await operation;
    },

    async resizeTerminal(
      terminalHandle: BackendTerminalHandle,
      rows: number,
      cols: number,
    ): Promise<void> {
      await invokeFunction<void>("resize_terminal", {
        sessionId: terminalHandle,
        rows,
        cols,
      });
    },

    async closeTerminal(terminalHandle: BackendTerminalHandle): Promise<void> {
      await invokeFunction<void>("close_terminal", {
        sessionId: terminalHandle,
      });
    },

    async uploadImageToSshTerminal(
      terminalHandle: BackendTerminalHandle,
      filename: string,
      data: Uint8Array,
    ): Promise<string> {
      return invokeFunction<string>("upload_image_to_ssh_terminal", {
        sessionId: terminalHandle,
        filename,
        data,
      });
    },
  };
}

function normalizeTerminalInfo(terminal: TerminalInfoDto): TerminalInfoDto {
  return {
    ...terminal,
    id: toBackendTerminalHandle(terminal.id),
  };
}

async function defaultInvoke<Value>(
  command: string,
  args?: Record<string, unknown>,
): Promise<Value> {
  return invoke<Value>(command, args);
}

export const terminalCommands = createTerminalCommandClient();
