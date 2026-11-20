import { invoke } from "@tauri-apps/api/core";
import type { SplitDirection } from "../../../models";
import { toSshConfigDto } from "../../terminal-stream";
import {
  toBackendTerminalHandle,
  type TerminalInfoDto,
} from "../../terminal-stream/adapterContracts";
import type { TmuxSessionConfig } from "../../launch-config";
import { toBackendControllerHandle, toBackendWindowHandle } from "./handles";
import { type TmuxSessionConfigDto } from "./tauriContracts";

type InvokeFunction = <Value>(command: string, args?: Record<string, unknown>) => Promise<Value>;

export interface TmuxCommandClient {
  createTmuxSession(config: TmuxSessionConfig): Promise<TerminalInfoDto>;
  attachTmuxSession(config: TmuxSessionConfig): Promise<TerminalInfoDto>;
  detachTmuxSession(controllerId: number): Promise<void>;
  resizeTmuxWindow(controllerId: number, cols: number, rows: number): Promise<void>;
  createTmuxPane(
    controllerId: number,
    parentTerminalId: number,
    direction: SplitDirection,
  ): Promise<TerminalInfoDto>;
  killTmuxPane(terminalId: number): Promise<void>;
  captureTmuxPane(terminalId: number, lines: number): Promise<string>;
  createTmuxWindow(controllerId: number, name?: string): Promise<TerminalInfoDto>;
  killTmuxWindow(windowId: number): Promise<void>;
  renameTmuxWindow(windowId: number, name: string): Promise<void>;
}

export function createTmuxCommandClient(
  invokeFunction: InvokeFunction = defaultInvoke,
): TmuxCommandClient {
  return {
    async createTmuxSession(config: TmuxSessionConfig): Promise<TerminalInfoDto> {
      const terminal = await invokeFunction<TerminalInfoDto>("create_tmux_session", {
        config: toTmuxSessionConfigDto(config),
      });
      return normalizeTerminalInfo(terminal);
    },

    async attachTmuxSession(config: TmuxSessionConfig): Promise<TerminalInfoDto> {
      const terminal = await invokeFunction<TerminalInfoDto>("attach_tmux_session", {
        config: toTmuxSessionConfigDto(config),
      });
      return normalizeTerminalInfo(terminal);
    },

    async detachTmuxSession(controllerId: number): Promise<void> {
      await invokeFunction<void>("detach_tmux_session", {
        controllerId: toBackendControllerHandle(controllerId),
      });
    },

    async resizeTmuxWindow(controllerId: number, cols: number, rows: number): Promise<void> {
      await invokeFunction<void>("resize_tmux_window", {
        controllerId: toBackendControllerHandle(controllerId),
        cols,
        rows,
      });
    },

    async createTmuxPane(
      controllerId: number,
      parentTerminalId: number,
      direction: SplitDirection,
    ): Promise<TerminalInfoDto> {
      const terminal = await invokeFunction<TerminalInfoDto>("create_tmux_pane", {
        controllerId: toBackendControllerHandle(controllerId),
        parentXstermTerminalId: toBackendTerminalHandle(parentTerminalId),
        direction,
      });
      return normalizeTerminalInfo(terminal);
    },

    async killTmuxPane(terminalId: number): Promise<void> {
      await invokeFunction<void>("kill_tmux_pane", {
        xstermTerminalId: toBackendTerminalHandle(terminalId),
      });
    },

    async captureTmuxPane(terminalId: number, lines: number): Promise<string> {
      return invokeFunction<string>("capture_tmux_pane", {
        xstermTerminalId: toBackendTerminalHandle(terminalId),
        lines,
      });
    },

    async createTmuxWindow(controllerId: number, name?: string): Promise<TerminalInfoDto> {
      const terminal = await invokeFunction<TerminalInfoDto>("create_tmux_window", {
        controllerId: toBackendControllerHandle(controllerId),
        name,
      });
      return normalizeTerminalInfo(terminal);
    },

    async killTmuxWindow(windowId: number): Promise<void> {
      await invokeFunction<void>("kill_tmux_window", {
        xstermWindowId: toBackendWindowHandle(windowId),
      });
    },

    async renameTmuxWindow(windowId: number, name: string): Promise<void> {
      await invokeFunction<void>("rename_tmux_window", {
        xstermWindowId: toBackendWindowHandle(windowId),
        name,
      });
    },
  };
}

function toTmuxSessionConfigDto(config: TmuxSessionConfig): TmuxSessionConfigDto {
  const { ssh, ...rest } = config;
  return {
    ...rest,
    ...(ssh ? { ssh: toSshConfigDto(ssh) } : {}),
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

export const tmuxCommands = createTmuxCommandClient();
