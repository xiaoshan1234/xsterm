import { useCallback, useEffect, useState } from "react";
import type { ToolId } from "./types";

export function useRuntimeShellUiState(paneTargetKeys: readonly string[]) {
  const [activeTool, setActiveTool] = useState<ToolId | null>(null);
  const [isTextSenderOpen, setIsTextSenderOpen] = useState(false);
  const [selectedTargetKey, setSelectedTargetKey] = useState("");

  useEffect(() => {
    if (paneTargetKeys.length > 0 && !paneTargetKeys.includes(selectedTargetKey)) {
      setSelectedTargetKey(paneTargetKeys[0]);
    } else if (paneTargetKeys.length === 0 && selectedTargetKey) {
      setSelectedTargetKey("");
    }
  }, [paneTargetKeys, selectedTargetKey]);

  const toggleTool = useCallback((tool: ToolId) => {
    setActiveTool((currentTool) => (currentTool === tool ? null : tool));
  }, []);

  const toggleTextSender = useCallback(() => {
    setIsTextSenderOpen((current) => !current);
  }, []);

  return {
    activeTool,
    isTextSenderOpen,
    selectedTargetKey,
    setSelectedTargetKey,
    toggleTextSender,
    toggleTool,
  };
}
