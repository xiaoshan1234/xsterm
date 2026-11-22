import { useMemo } from "react";
import type { TerminalId } from "../../../models";
import type { TerminalRuntimeContextType, ApplicationState } from "./types";
import type { useTerminalActions } from "./useTerminalActions";

interface UseTerminalRuntimeValueOptions {
  state: ApplicationState;
  actions: ReturnType<typeof useTerminalActions>;
  getTerminalSize: (terminalId: TerminalId) => { rows: number; cols: number } | undefined;
}

export function useTerminalRuntimeValue({
  state,
  actions,
  getTerminalSize,
}: UseTerminalRuntimeValueOptions): TerminalRuntimeContextType {
  return useMemo(
    () => ({
      terminals: state.terminal.terminals,
      terminalSizesVersion: state.terminal.terminalSizesVersion,
      getTerminalSize,
      getEffectiveLocalEcho: state.preferences.getEffectiveLocalEcho,
      createLocalSession: actions.createLocalSession,
      createSshSession: actions.createSshSession,
      createLocalSessionOnly: actions.createLocalSessionOnly,
      createSshSessionOnly: actions.createSshSessionOnly,
      closeTerminal: actions.closeTerminal,
      reconnectSession: actions.reconnectSession,
      renameSession: actions.renameSession,
      writeTerminal: actions.writeTerminal,
      resizeTerminal: actions.resizeTerminal,
      uploadImageToSshTerminal: actions.uploadImageToSshTerminal,
      reportTerminalSize: actions.reportTerminalSize,
      applyDisplayConfigToLiveSession: actions.applyDisplayConfigToLiveSession,
      toggleBookmark: actions.toggleBookmark,
      touchTerminalActivity: actions.touchTerminalActivity,
    }),
    [
      actions.applyDisplayConfigToLiveSession,
      actions.closeTerminal,
      actions.createLocalSession,
      actions.createLocalSessionOnly,
      actions.createSshSession,
      actions.createSshSessionOnly,
      actions.reconnectSession,
      actions.renameSession,
      actions.reportTerminalSize,
      actions.resizeTerminal,
      actions.toggleBookmark,
      actions.touchTerminalActivity,
      actions.uploadImageToSshTerminal,
      actions.writeTerminal,
      getTerminalSize,
      state.preferences.getEffectiveLocalEcho,
      state.terminal.terminalSizesVersion,
      state.terminal.terminals,
    ],
  );
}
