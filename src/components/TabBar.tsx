import { useState } from "react";
import { Box, Tabs, Tab, IconButton } from "@mui/material";
import { Close as CloseIcon } from "@mui/icons-material";

interface TabItem {
  id: string;
  label: string;
  closable?: boolean;
  sessionType?: "local" | "ssh" | "init";
}

interface TabBarProps {
  tabs: TabItem[];
  activeTab: string | null;
  onSelect: (id: string) => void;
  onClose?: (id: string) => void;
  onContextMenu?: (e: React.MouseEvent, id: string) => void;
}

export function TabBar({ tabs, activeTab, onSelect, onClose, onContextMenu }: TabBarProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (draggedId && draggedId !== targetId) {
      // Drag-drop logic preserved at higher level
    }
    setDraggedId(null);
  };

  const activeIndex = tabs.findIndex((t) => t.id === activeTab);

  return (
    <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
      <Tabs
        value={activeIndex >= 0 ? activeIndex : false}
        variant="scrollable"
        scrollButtons="auto"
      >
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            label={
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, opacity: draggedId === tab.id ? 0.4 : 1 }}>
                <span>{tab.label}</span>
                {tab.closable && onClose && (
                  <IconButton
                    size="small"
                    component="span"
                    onClick={(e) => {
                      e.stopPropagation();
                      onClose(tab.id);
                    }}
                    sx={{ p: 0.25 }}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                )}
              </Box>
            }
            draggable
            onDragStart={(e) => handleDragStart(e, tab.id)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, tab.id)}
            onClick={() => onSelect(tab.id)}
            onContextMenu={(e) => onContextMenu?.(e, tab.id)}
            sx={{ minHeight: 32, textTransform: "none", fontSize: "0.8125rem" }}
          />
        ))}
      </Tabs>
    </Box>
  );
}
