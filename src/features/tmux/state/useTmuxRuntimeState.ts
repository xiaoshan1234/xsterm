import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { TmuxSessionConfig } from "../../../models/runtime/tmux";
import { type OpenTmuxSession, type TmuxControllerError } from "./types";

export interface TmuxRuntimeState {
  tmuxControllerErrors: Map<number, TmuxControllerError>;
  setTmuxControllerErrors: Dispatch<SetStateAction<Map<number, TmuxControllerError>>>;
  tmuxControllerConfigsRef: MutableRefObject<Map<number, TmuxSessionConfig>>;
  tmuxControllerConfigIdsRef: MutableRefObject<Map<number, string>>;
  openTmuxSessions: OpenTmuxSession[];
  syncOpenTmuxSessions: () => void;
  pendingTmuxSessionKeysRef: MutableRefObject<Set<string>>;
  tmuxControllersClosingRef: MutableRefObject<Set<number>>;
}

export function useTmuxRuntimeState(): TmuxRuntimeState {
  const [tmuxControllerErrors, setTmuxControllerErrors] = useState<
    Map<number, TmuxControllerError>
  >(new Map());
  const [openTmuxSessions, setOpenTmuxSessions] = useState<OpenTmuxSession[]>([]);
  const tmuxControllerConfigsRef = useRef<Map<number, TmuxSessionConfig>>(new Map());
  const tmuxControllerConfigIdsRef = useRef<Map<number, string>>(new Map());
  const pendingTmuxSessionKeysRef = useRef<Set<string>>(new Set());
  const tmuxControllersClosingRef = useRef<Set<number>>(new Set());

  const syncOpenTmuxSessions = useCallback(() => {
    const configIds = tmuxControllerConfigIdsRef.current;
    setOpenTmuxSessions(
      [...tmuxControllerConfigsRef.current.entries()].map(([controllerId, config]) => ({
        controllerId,
        ...(configIds.has(controllerId) ? { configId: configIds.get(controllerId) } : {}),
        config,
      })),
    );
  }, []);

  return {
    tmuxControllerErrors,
    setTmuxControllerErrors,
    tmuxControllerConfigsRef,
    tmuxControllerConfigIdsRef,
    openTmuxSessions,
    syncOpenTmuxSessions,
    pendingTmuxSessionKeysRef,
    tmuxControllersClosingRef,
  };
}
