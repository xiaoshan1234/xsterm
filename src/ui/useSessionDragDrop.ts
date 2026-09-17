import { useCallback, useState } from "react";

interface UseSessionDragDropArgs {
  /** Called when a configId is dropped onto a groupId. */
  onDrop: (configId: string, groupId: number) => void;
}

export interface SessionDragDrop {
  dragOverGroupId: number | null;
  handleDragStart: (e: React.DragEvent, configId: string) => void;
  handleGroupDragOver: (e: React.DragEvent, groupId: number) => void;
  handleGroupDragLeave: () => void;
  handleGroupDrop: (e: React.DragEvent, groupId: number) => void;
}

const SESSION_CONFIG_MIME = "text/x-session-config-id";

/**
 * Tracks which group is being hovered during a drag, and provides the
 * standard dragstart / dragover / dragleave / drop handlers used by the
 * session manager sidebar.
 */
export function useSessionDragDrop({ onDrop }: UseSessionDragDropArgs): SessionDragDrop {
  const [dragOverGroupId, setDragOverGroupId] = useState<number | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, configId: string) => {
    e.dataTransfer.setData(SESSION_CONFIG_MIME, configId);
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleGroupDragOver = useCallback((e: React.DragEvent, groupId: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverGroupId(groupId);
  }, []);

  const handleGroupDragLeave = useCallback(() => {
    setDragOverGroupId(null);
  }, []);

  const handleGroupDrop = useCallback(
    (e: React.DragEvent, groupId: number) => {
      e.preventDefault();
      const configId = e.dataTransfer.getData(SESSION_CONFIG_MIME);
      if (configId) {
        onDrop(configId, groupId);
      }
      setDragOverGroupId(null);
    },
    [onDrop],
  );

  return {
    dragOverGroupId,
    handleDragStart,
    handleGroupDragOver,
    handleGroupDragLeave,
    handleGroupDrop,
  };
}
