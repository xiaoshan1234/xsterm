import { useCallback } from "react";
import type { TerminalId } from "../../../models";
import type { Terminal, TerminalDisplayConfig } from "../../../features/terminal";
import type { SavedTerminalConfig } from "../../../features/launch-config";

interface UseTerminalMetadataActionsOptions {
  terminalsRef: React.MutableRefObject<Terminal[]>;
  setSessions: React.Dispatch<React.SetStateAction<Terminal[]>>;
  updateConfigs: (updater: (previous: SavedTerminalConfig[]) => SavedTerminalConfig[]) => void;
}

export function useTerminalMetadataActions({
  terminalsRef,
  setSessions,
  updateConfigs,
}: UseTerminalMetadataActionsOptions) {
  const renameSession = useCallback(
    (terminalId: TerminalId, name: string) => {
      setSessions((previous) =>
        previous.map((terminal) => (terminal.id === terminalId ? { ...terminal, name } : terminal)),
      );
      const terminal = terminalsRef.current.find((candidate) => candidate.id === terminalId);
      if (terminal) {
        updateConfigs((previous) =>
          previous.map((config) =>
            config.id === terminal.configId ? { ...config, name } : config,
          ),
        );
      }
    },
    [setSessions, terminalsRef, updateConfigs],
  );

  const applyDisplayConfigToLiveSession = useCallback(
    (terminalId: TerminalId, patch: Partial<TerminalDisplayConfig>) => {
      setSessions((previous) =>
        previous.map((terminal) =>
          terminal.id === terminalId
            ? { ...terminal, displayConfig: { ...(terminal.displayConfig ?? {}), ...patch } }
            : terminal,
        ),
      );
    },
    [setSessions],
  );

  return { applyDisplayConfigToLiveSession, renameSession };
}
