import { useCallback, useEffect, useRef, useState } from "react";
import { TOOL_ORDER, type ToolId } from "./types";

export function useRuntimeShellUiState(paneTargetKeys: readonly string[]) {
  const [activeTool, setActiveTool] = useState<ToolId | null>(null);
  const [isTextSenderOpen, setIsTextSenderOpen] = useState(false);
  const [selectedTargetKey, setSelectedTargetKey] = useState("");
  const lastToolRef = useRef<ToolId>("terminal-manager");

  useEffect(() => {
    if (paneTargetKeys.length > 0 && !paneTargetKeys.includes(selectedTargetKey)) {
      setSelectedTargetKey(paneTargetKeys[0]);
    } else if (paneTargetKeys.length === 0 && selectedTargetKey) {
      setSelectedTargetKey("");
    }
  }, [paneTargetKeys, selectedTargetKey]);

  const toggleTool = useCallback((tool: ToolId) => {
    setActiveTool((currentTool) => {
      if (currentTool !== null && currentTool !== tool) {
        lastToolRef.current = currentTool;
      }
      const nextTool = currentTool === tool ? null : tool;
      if (nextTool !== null) {
        lastToolRef.current = nextTool;
      }
      return nextTool;
    });
  }, []);

  const toggleToolPanel = useCallback(() => {
    setActiveTool((currentTool) => (currentTool === null ? lastToolRef.current : null));
  }, []);

  const cycleTool = useCallback((step: 1 | -1) => {
    setActiveTool((currentTool) => {
      if (currentTool === null) {
        const nextTool = step === 1 ? TOOL_ORDER[0] : TOOL_ORDER[TOOL_ORDER.length - 1];
        lastToolRef.current = nextTool;
        return nextTool;
      }
      const currentIndex = TOOL_ORDER.indexOf(currentTool);
      const nextIndex = (currentIndex + step + TOOL_ORDER.length) % TOOL_ORDER.length;
      const nextTool = TOOL_ORDER[nextIndex];
      lastToolRef.current = nextTool;
      return nextTool;
    });
  }, []);

  const toggleTextSender = useCallback(() => {
    setIsTextSenderOpen((current) => !current);
  }, []);

  return {
    activeTool,
    cycleTool,
    isTextSenderOpen,
    selectedTargetKey,
    setSelectedTargetKey,
    toggleToolPanel,
    toggleTextSender,
    toggleTool,
  };
}
