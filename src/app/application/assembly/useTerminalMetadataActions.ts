import { useCallback } from "react";
import type { TerminalId } from "../../../models";
import type { Terminal, TerminalProperties } from "../../../features/terminal";
import type { SavedTerminalConfig } from "../../../features/launch-config";

interface UseTerminalMetadataActionsOptions {
  terminalsRef: React.MutableRefObject<Terminal[]>;
  setTerminals: React.Dispatch<React.SetStateAction<Terminal[]>>;
  updateConfigs: (updater: (previous: SavedTerminalConfig[]) => SavedTerminalConfig[]) => void;
}

export function useTerminalMetadataActions({
  terminalsRef,
  setTerminals,
  updateConfigs,
}: UseTerminalMetadataActionsOptions) {
  const renameSession = useCallback(
    (terminalId: TerminalId, name: string) => {
      setTerminals((previous) =>
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
    [setTerminals, terminalsRef, updateConfigs],
  );

  const updateTerminalProperties = useCallback(
    (terminalId: TerminalId, patch: Partial<TerminalProperties>) => {
      setTerminals((previous) =>
        previous.map((terminal) =>
          terminal.id === terminalId
            ? { ...terminal, properties: { ...terminal.properties, ...patch } }
            : terminal,
        ),
      );
    },
    [setTerminals],
  );

  const toggleBookmark = useCallback(
    (terminalId: TerminalId, line: number, text: string) => {
      setTerminals((previous) =>
        previous.map((terminal) => {
          if (terminal.id !== terminalId) return terminal;
          const current = terminal.bookmarks ?? [];
          const present = current.some((bookmark) => bookmark.line === line);
          const next = present
            ? current.filter((bookmark) => bookmark.line !== line)
            : [...current, { line, text }].sort((a, b) => a.line - b.line);
          return { ...terminal, bookmarks: next.length > 0 ? next : undefined };
        }),
      );
    },
    [setTerminals],
  );

  const removeBookmark = useCallback(
    (terminalId: TerminalId, line: number) => {
      setTerminals((previous) =>
        previous.map((terminal) => {
          if (terminal.id !== terminalId) return terminal;
          const next = (terminal.bookmarks ?? []).filter((bookmark) => bookmark.line !== line);
          return { ...terminal, bookmarks: next.length > 0 ? next : undefined };
        }),
      );
    },
    [setTerminals],
  );

  const clearBookmarks = useCallback(
    (terminalId: TerminalId) => {
      setTerminals((previous) =>
        previous.map((terminal) =>
          terminal.id === terminalId ? { ...terminal, bookmarks: undefined } : terminal,
        ),
      );
    },
    [setTerminals],
  );

  return {
    updateTerminalProperties,
    clearBookmarks,
    removeBookmark,
    renameSession,
    toggleBookmark,
  };
}
