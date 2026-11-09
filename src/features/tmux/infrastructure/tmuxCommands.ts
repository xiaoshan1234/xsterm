import { invoke } from "@tauri-apps/api/core";
import {
  toBackendTerminalHandle,
  type BackendTerminalHandle,
} from "../../terminal/infrastructure/handles";
import { type TerminalInfoDto } from "../../terminal/infrastructure/tauriContracts";
import { type BackendControllerHandle, type BackendWindowHandle } from "./handles";
import {
  type AttachedTmuxServerDto,
  type AutoAttachOutcomeDto,
  type TmuxSessionConfigDto,
} from "./tauriContracts";

type SplitDirection = "horizontal" | "vertical";

type InvokeFunction = <Value>(command: string, args?: Record<string, unknown>) => Promise<Value>;

export interface TmuxCommandClient {
  createTmuxSession(config: TmuxSessionConfigDto): Promise<TerminalInfoDto>;
  attachTmuxSession(config: TmuxSessionConfigDto): Promise<TerminalInfoDto>;
  detachTmuxSession(controllerHandle: BackendControllerHandle): Promise<void>;
  closeAllTmuxWindows(controllerHandle: BackendControllerHandle): Promise<void>;
  createTmuxPane(
    controllerHandle: BackendControllerHandle,
    parentTerminalHandle: BackendTerminalHandle,
    direction: SplitDirection,
  ): Promise<TerminalInfoDto>;
  killTmuxPane(terminalHandle: BackendTerminalHandle): Promise<void>;
  captureTmuxPane(terminalHandle: BackendTerminalHandle, lines: number): Promise<string>;
  createTmuxWindow(
    controllerHandle: BackendControllerHandle,
    name?: string,
  ): Promise<TerminalInfoDto>;
  killTmuxWindow(windowHandle: BackendWindowHandle): Promise<void>;
  renameTmuxWindow(windowHandle: BackendWindowHandle, name: string): Promise<void>;
  getAttachedTmuxServers(): Promise<AttachedTmuxServerDto[]>;
  autoAttachTmuxServers(): Promise<AutoAttachOutcomeDto[]>;
}

export function createTmuxCommandClient(
  invokeFunction: InvokeFunction = defaultInvoke,
): TmuxCommandClient {
  return {
    async createTmuxSession(config: TmuxSessionConfigDto): Promise<TerminalInfoDto> {
      const terminal = await invokeFunction<TerminalInfoDto>("create_tmux_session", {
        config,
      });
      return normalizeTerminalInfo(terminal);
    },

    async attachTmuxSession(config: TmuxSessionConfigDto): Promise<TerminalInfoDto> {
      const terminal = await invokeFunction<TerminalInfoDto>("attach_tmux_session", {
        config,
      });
      return normalizeTerminalInfo(terminal);
    },

    async detachTmuxSession(controllerHandle: BackendControllerHandle): Promise<void> {
      await invokeFunction<void>("detach_tmux_session", {
        controllerId: controllerHandle,
      });
    },

    async closeAllTmuxWindows(controllerHandle: BackendControllerHandle): Promise<void> {
      await invokeFunction<void>("close_all_tmux_windows", {
        controllerId: controllerHandle,
      });
    },

    async createTmuxPane(
      controllerHandle: BackendControllerHandle,
      parentTerminalHandle: BackendTerminalHandle,
      direction: SplitDirection,
    ): Promise<TerminalInfoDto> {
      const terminal = await invokeFunction<TerminalInfoDto>("create_tmux_pane", {
        controllerId: controllerHandle,
        parentXstermSessionId: parentTerminalHandle,
        direction,
      });
      return normalizeTerminalInfo(terminal);
    },

    async killTmuxPane(terminalHandle: BackendTerminalHandle): Promise<void> {
      await invokeFunction<void>("kill_tmux_pane", {
        xstermSessionId: terminalHandle,
      });
    },

    async captureTmuxPane(terminalHandle: BackendTerminalHandle, lines: number): Promise<string> {
      return invokeFunction<string>("capture_tmux_pane", {
        xstermSessionId: terminalHandle,
        lines,
      });
    },

    async createTmuxWindow(
      controllerHandle: BackendControllerHandle,
      name?: string,
    ): Promise<TerminalInfoDto> {
      const terminal = await invokeFunction<TerminalInfoDto>("create_tmux_window", {
        controllerId: controllerHandle,
        name,
      });
      return normalizeTerminalInfo(terminal);
    },

    async killTmuxWindow(windowHandle: BackendWindowHandle): Promise<void> {
      await invokeFunction<void>("kill_tmux_window", {
        xstermWindowId: windowHandle,
      });
    },

    async renameTmuxWindow(windowHandle: BackendWindowHandle, name: string): Promise<void> {
      await invokeFunction<void>("rename_tmux_window", {
        xstermWindowId: windowHandle,
        name,
      });
    },

    getAttachedTmuxServers(): Promise<AttachedTmuxServerDto[]> {
      return invokeFunction<AttachedTmuxServerDto[]>("get_attached_tmux_servers");
    },

    autoAttachTmuxServers(): Promise<AutoAttachOutcomeDto[]> {
      return invokeFunction<AutoAttachOutcomeDto[]>("auto_attach_tmux_servers");
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

export const tmuxCommands = createTmuxCommandClient();
