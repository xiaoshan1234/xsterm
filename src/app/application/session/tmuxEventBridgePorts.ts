import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { TerminalId } from "../../../models";
import type { TmuxSessionConfig } from "../../../features/launch-config";
import type { Terminal } from "../../../features/terminal";
import type { tmuxEventStream, TmuxControllerError } from "../../../features/tmux";
import type { Workspace } from "../../../features/workspace";

export interface TmuxEventBridgePorts {
  setTerminals: Dispatch<SetStateAction<Terminal[]>>;
  setWorkspaces: Dispatch<SetStateAction<Workspace[]>>;
  terminalsRef: MutableRefObject<Terminal[]>;
  workspacesRef: MutableRefObject<Workspace[]>;
  establishingTerminalsRef: MutableRefObject<Set<TerminalId>>;
  setTmuxControllerErrors: Dispatch<SetStateAction<Map<number, TmuxControllerError>>>;
  tmuxControllerConfigsRef: MutableRefObject<Map<number, TmuxSessionConfig>>;
  tmuxControllerConfigIdsRef: MutableRefObject<Map<number, string>>;
  syncOpenTmuxSessions: () => void;
  tmuxControllersClosingRef: MutableRefObject<Set<number>>;
}

export type TmuxEventHandlerSet = NonNullable<Parameters<typeof tmuxEventStream.subscribe>[0]>;
