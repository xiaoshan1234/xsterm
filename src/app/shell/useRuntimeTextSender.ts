import { useCallback, useMemo } from "react";
import type { TerminalId } from "../../models";
import type { PaneTargetOptionViewData } from "../../features/command-sender";

interface UseRuntimeTextSenderOptions {
  paneTargetOptions: readonly PaneTargetOptionViewData[];
  selectedTargetKey: string;
  writeTerminal: (terminalId: TerminalId, data: string) => Promise<void>;
  onError: (title: string, cause: unknown) => void;
}

export function useRuntimeTextSender({
  paneTargetOptions,
  selectedTargetKey,
  writeTerminal,
  onError,
}: UseRuntimeTextSenderOptions) {
  const selectedTarget = paneTargetOptions.find((option) => option.targetKey === selectedTargetKey);

  const targets = useMemo(
    () =>
      paneTargetOptions.map((option) => ({
        id: option.targetKey,
        label: option.displayInfo.title,
        breadcrumb: option.displayInfo.breadcrumb,
        status: option.displayInfo.isAvailable ? "Connected" : "Unavailable",
        isAvailable: option.displayInfo.isAvailable,
      })),
    [paneTargetOptions],
  );

  const sendText = useCallback(
    async (text: string) => {
      if (!selectedTarget || !text) return;
      await writeTerminal(selectedTarget.terminalId, text).catch((cause) => {
        onError("Unable to send command", cause);
        throw cause;
      });
    },
    [onError, selectedTarget, writeTerminal],
  );

  return { targets, sendText };
}
