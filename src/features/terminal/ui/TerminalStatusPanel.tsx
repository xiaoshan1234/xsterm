import { useState } from "react";
import { ManagerEmptyState, ManagerPanelFrame, ManagerRow } from "../../../shared/ui/ManagerPanel";
import { type TerminalStatusItemViewData } from "../viewModels/statusViewModel";

interface TerminalStatusPanelProps {
  items: readonly TerminalStatusItemViewData[];
  onFocus: (terminalId: number) => void;
  onReconnect: (terminalId: number) => void;
  onClose: (terminalId: number) => void;
}

export function TerminalStatusPanel({
  items,
  onFocus,
  onReconnect,
  onClose,
}: TerminalStatusPanelProps) {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  return (
    <ManagerPanelFrame>
      {items.length === 0 ? (
        <ManagerEmptyState>No live terminals.</ManagerEmptyState>
      ) : (
        items.map((item) => (
          <ManagerRow
            key={item.terminalId}
            title={item.title}
            badge={item.status === "connected" ? "Connected" : "Disconnected"}
            isSelected={selectedId === item.terminalId}
            onSelect={() => setSelectedId(item.terminalId)}
            onOpen={() => onFocus(item.terminalId)}
            contextMenuItems={[
              ...(item.canReconnect
                ? [
                    {
                      id: "reconnect",
                      label: "Reconnect",
                      onClick: () => onReconnect(item.terminalId),
                    },
                  ]
                : []),
              {
                id: "close",
                label: "Close",
                onClick: () => onClose(item.terminalId),
                danger: true,
              },
            ]}
          />
        ))
      )}
    </ManagerPanelFrame>
  );
}
