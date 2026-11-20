import { useCallback, useRef, useState } from "react";
import { isApplicationError } from "../../../models/applicationError";
import type { PaneId, TerminalId, WindowId, WorkspaceId } from "../../../models";
import type { Terminal } from "../../terminal";
import type { PaneIntentActions, PaneSessionIntentActions, PaneSplitDirection } from "../contracts";

type DialogMode = "split" | "attach";

interface UsePaneSessionDialogControllerOptions {
  workspaceId: WorkspaceId;
  windowId: WindowId;
  paneId: PaneId;
  terminal?: Terminal;
  paneTerminalId?: TerminalId;
  paneConfigId?: string;
  terminals: readonly Terminal[];
  paneIntents: Pick<PaneIntentActions, "attachExistingTerminal" | "splitPaneWithTerminal">;
  paneSessionIntents: Pick<
    PaneSessionIntentActions,
    "attachSavedConfigToPane" | "splitPaneWithSavedConfig"
  >;
  reportError: (title: string, cause: unknown) => void;
}

export function usePaneSessionDialogController({
  workspaceId,
  windowId,
  paneId,
  terminal,
  paneTerminalId,
  paneConfigId,
  terminals,
  paneIntents,
  paneSessionIntents,
  reportError,
}: UsePaneSessionDialogControllerOptions) {
  const [showSessionDialog, setShowSessionDialog] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode | null>(null);
  const [pendingSplit, setPendingSplit] = useState<PaneSplitDirection | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);

  const startSubmitting = useCallback(() => {
    if (isSubmittingRef.current) return false;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    return true;
  }, []);

  const endSubmitting = useCallback(() => {
    isSubmittingRef.current = false;
    setIsSubmitting(false);
  }, []);

  const resetDialog = useCallback(() => {
    setShowSessionDialog(false);
    setPendingSplit(null);
    setDialogMode(null);
  }, []);

  const attachTerminalToPane = useCallback(
    (terminalId: TerminalId) =>
      paneIntents.attachExistingTerminal({
        workspaceId,
        windowId,
        paneId,
        terminalId,
      }),
    [paneId, paneIntents, windowId, workspaceId],
  );

  const startSplit = useCallback(
    (direction: PaneSplitDirection) => {
      if (terminal?.capabilities?.supportsMultiplex && paneTerminalId !== undefined) {
        void paneIntents
          .splitPaneWithTerminal({
            workspaceId,
            windowId,
            paneId,
            direction,
            terminalId: paneTerminalId,
            configId: paneConfigId,
          })
          .catch((error) => reportError("Failed to split terminal", error));
        return;
      }
      setPendingSplit(direction);
      setDialogMode("split");
      setShowSessionDialog(true);
    },
    [
      paneConfigId,
      paneId,
      paneIntents,
      paneTerminalId,
      reportError,
      terminal,
      windowId,
      workspaceId,
    ],
  );

  const startAttach = useCallback(() => {
    setPendingSplit(null);
    setDialogMode("attach");
    setShowSessionDialog(true);
  }, []);

  const selectSession = useCallback(
    async (terminalId: TerminalId) => {
      if (!startSubmitting()) return;
      try {
        if (dialogMode === "split" && pendingSplit) {
          const terminalConfigId = terminals.find(
            (candidate) => candidate.id === terminalId,
          )?.configId;
          await paneIntents.splitPaneWithTerminal({
            workspaceId,
            windowId,
            paneId,
            direction: pendingSplit,
            terminalId,
            configId: terminalConfigId,
          });
        } else if (dialogMode === "attach") {
          await attachTerminalToPane(terminalId);
        }
        resetDialog();
      } catch (error) {
        reportError(
          isApplicationError(error, "terminal-already-attached")
            ? "Terminal is already used in another window"
            : "Failed to attach terminal",
          error,
        );
      } finally {
        endSubmitting();
      }
    },
    [
      attachTerminalToPane,
      dialogMode,
      endSubmitting,
      paneId,
      paneIntents,
      pendingSplit,
      reportError,
      resetDialog,
      startSubmitting,
      terminals,
      windowId,
      workspaceId,
    ],
  );

  const selectConfig = useCallback(
    async (configId: string) => {
      if (!startSubmitting()) return;
      try {
        if (dialogMode === "split" && pendingSplit) {
          await paneSessionIntents.splitPaneWithSavedConfig({
            workspaceId,
            windowId,
            paneId,
            direction: pendingSplit,
            configId,
          });
        } else if (dialogMode === "attach") {
          await paneSessionIntents.attachSavedConfigToPane({
            workspaceId,
            windowId,
            paneId,
            configId,
          });
        }
        resetDialog();
      } catch (error) {
        reportError(
          isApplicationError(error, "terminal-already-attached")
            ? "Terminal is already used in another window"
            : "Failed to create terminal",
          error,
        );
      } finally {
        endSubmitting();
      }
    },
    [
      dialogMode,
      endSubmitting,
      paneId,
      paneSessionIntents,
      pendingSplit,
      reportError,
      resetDialog,
      startSubmitting,
      windowId,
      workspaceId,
    ],
  );

  const closeDialog = useCallback(() => {
    if (isSubmittingRef.current) return;
    resetDialog();
  }, [resetDialog]);

  return {
    attachTerminalToPane,
    closeDialog,
    isSubmitting,
    selectConfig,
    selectSession,
    showSessionDialog,
    startAttach,
    startSplit,
  };
}
