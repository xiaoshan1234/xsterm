import { useCallback, useEffect, useState } from "react";
import type { HelpDialogId } from "./HelpDialog";
import {
  type RuntimeConfirmState,
  type RuntimeDialog,
  type RuntimeErrorState,
} from "./runtimeOverlayTypes";
import type { ApplicationPersistenceSaveError } from "../application/assembly/types";

interface RuntimeOverlayControllerOptions {
  saveError: ApplicationPersistenceSaveError | null;
  clearSaveError: () => void;
}

export function useRuntimeOverlayController({
  saveError,
  clearSaveError,
}: RuntimeOverlayControllerOptions) {
  const [dialog, setDialog] = useState<RuntimeDialog>(null);
  const [confirm, setConfirm] = useState<RuntimeConfirmState | null>(null);
  const [error, setError] = useState<RuntimeErrorState | null>(null);
  const [helpDialog, setHelpDialog] = useState<HelpDialogId | null>(null);

  const showError = useCallback((title: string, cause: unknown) => {
    setError({
      title,
      message: cause instanceof Error ? cause.message : String(cause),
      details: cause instanceof Error ? cause.stack : undefined,
    });
  }, []);

  useEffect(() => {
    if (!saveError || error !== null) return;
    setError({
      title: persistenceErrorTitle(saveError.source),
      message: saveError.message,
    });
    clearSaveError();
  }, [clearSaveError, error, saveError]);

  const closeDialog = useCallback(() => setDialog(null), []);
  const dismissConfirm = useCallback(() => setConfirm(null), []);
  const acknowledgeError = useCallback(() => setError(null), []);
  const closeHelp = useCallback(() => setHelpDialog(null), []);

  return {
    dialog,
    confirm,
    error,
    helpDialog,
    showError,
    openDialog: setDialog,
    requestConfirm: setConfirm,
    openHelp: setHelpDialog,
    closeDialog,
    dismissConfirm,
    acknowledgeError,
    closeHelp,
  };
}

function persistenceErrorTitle(source: ApplicationPersistenceSaveError["source"]): string {
  switch (source) {
    case "launch-config":
      return "Unable to save terminal configuration";
    case "workspace":
      return "Unable to save workspace configuration";
    case "settings":
      return "Unable to save terminal preferences";
  }
}
