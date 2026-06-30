import { MouseEvent, useState, useRef, useMemo, DragEvent, Fragment } from "react";
import { Session, SessionPane } from "../types/session";
import {
  LocalSessionIcon,
  SshSessionIcon,
  TmuxSessionIcon,
  SshTmuxSessionIcon,
  CloseIcon,
  SettingsIcon,
} from "./icons/Icon";
import { ContextMenu, ContextMenuItem } from "./ui/ContextMenu";
import "./TabBar.css";

interface TabBarProps {
  sessions: Session[];
  activeId: number | null;
  activeView: "terminal" | "settings";
  showSettingsTab: boolean;
  pane?: SessionPane;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
  onRename?: (id: number, name: string) => void;
  onSelectSettings: () => void;
  onCloseSettings?: () => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  onMoveToPane?: (sessionId: number, pane: SessionPane) => void;
}

export default function TabBar({
  sessions,
  activeId,
  activeView,
  showSettingsTab,
  pane,
  onSelect,
  onClose,
  onRename,
  onSelectSettings,
  onCloseSettings,
  onReorder,
  onMoveToPane,
}: TabBarProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const tabRefs = useRef<(HTMLDivElement | null)[]>([]);

  const displayNames = useMemo(() => {
    const configIdToIds = new Map<string, number[]>();
    sessions.forEach((session) => {
      const ids = configIdToIds.get(session.configId) || [];
      ids.push(session.id);
      configIdToIds.set(session.configId, ids);
    });

    const configIdToOrdinal = new Map<string, Map<number, number>>();
    configIdToIds.forEach((ids, configId) => {
      if (ids.length <= 1) return;
      const sortedIds = [...ids].sort((a, b) => a - b);
      const ordinalMap = new Map<number, number>();
      sortedIds.forEach((id, index) => {
        ordinalMap.set(id, index + 1);
      });
      configIdToOrdinal.set(configId, ordinalMap);
    });

    const result = new Map<number, string>();
    sessions.forEach((session) => {
      const ordinalMap = configIdToOrdinal.get(session.configId);
      const ordinal = ordinalMap?.get(session.id);
      if (ordinal !== undefined) {
        result.set(session.id, `${session.name}:${ordinal}`);
      } else {
        result.set(session.id, session.name);
      }
    });
    return result;
  }, [sessions]);

  const handleMiddleClick = (e: MouseEvent, sessionId: number) => {
    if (e.button === 1) {
      e.preventDefault();
      onClose(sessionId);
    }
  };

  const handleDoubleClick = (session: Session) => {
    if (onRename) {
      setEditingId(session.id);
      setEditValue(session.name);
    }
  };

  const handleEditSubmit = (sessionId: number) => {
    if (editValue.trim() && onRename) {
      onRename(sessionId, editValue.trim());
    }
    setEditingId(null);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent, sessionId: number) => {
    if (e.key === "Enter") {
      handleEditSubmit(sessionId);
    } else if (e.key === "Escape") {
      setEditingId(null);
    }
  };

  const handleDragStart = (e: DragEvent<HTMLDivElement>, session: Session) => {
    if ((e.target as HTMLElement).closest(".tab-close")) {
      e.preventDefault();
      return;
    }
    setDraggedId(session.id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(session.id));
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (draggedId === null) return;

    const tabElements = tabRefs.current.filter((el): el is HTMLDivElement => el !== null);
    if (tabElements.length === 0) return;

    let newIndex = sessions.length;
    for (let i = 0; i < tabElements.length; i++) {
      const rect = tabElements[i].getBoundingClientRect();
      const midpoint = rect.left + rect.width / 2;
      if (e.clientX < midpoint) {
        newIndex = i;
        break;
      }
    }
    setDragOverIndex(newIndex);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (draggedId === null || dragOverIndex === null) return;
    const fromIndex = sessions.findIndex((s) => s.id === draggedId);
    if (fromIndex === -1) return;
    onReorder?.(fromIndex, dragOverIndex);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverIndex(null);
  };

  const renderTab = (session: Session, index: number) => {
    const paneItems: ContextMenuItem[] = [];
    if (onMoveToPane) {
      const panes: SessionPane[] = [1, 2, 3, 4];
      for (const targetPane of panes) {
        if (targetPane === (session.pane ?? 1)) continue;
        paneItems.push({
          label: `移动到 Pane ${targetPane}`,
          onClick: () => onMoveToPane(session.id, targetPane),
        });
      }
    }

    const tab = (
      <div
        ref={(el) => {
          tabRefs.current[index] = el;
        }}
        className={`tab ${session.id === activeId ? "active" : ""} ${
          session.id === draggedId ? "dragging" : ""
        }`}
        draggable={onReorder !== undefined}
        onClick={() => onSelect(session.id)}
        onMouseDown={(e) => handleMiddleClick(e, session.id)}
        onDoubleClick={() => handleDoubleClick(session)}
        onDragStart={(e) => handleDragStart(e, session)}
        onDragEnd={handleDragEnd}
      >
        <span className="tab-icon">
          {session.type === "local" ? (
            <LocalSessionIcon size={14} />
          ) : session.type === "ssh" ? (
            <SshSessionIcon size={14} />
          ) : session.type === "tmux" ? (
            <TmuxSessionIcon size={14} />
          ) : (
            <SshTmuxSessionIcon size={14} />
          )}
        </span>
        {editingId === session.id ? (
          <input
            type="text"
            className="tab-title-input"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => handleEditSubmit(session.id)}
            onKeyDown={(e) => handleEditKeyDown(e, session.id)}
            autoFocus
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="tab-title">{displayNames.get(session.id) ?? session.name}</span>
        )}
        {!session.is_connected && <span className="tab-disconnected">!</span>}
        <button
          className="tab-close"
          draggable={false}
          onClick={(e) => {
            e.stopPropagation();
            onClose(session.id);
          }}
        >
          <CloseIcon size={12} />
        </button>
      </div>
    );

    return (
      <Fragment key={session.id}>
        {dragOverIndex === index && draggedId !== null && (
          <div className="tab-drop-indicator" />
        )}
        {paneItems.length > 0 ? (
          <ContextMenu items={paneItems}>{tab}</ContextMenu>
        ) : (
          tab
        )}
      </Fragment>
    );
  };

  return (
    <div className="tab-bar" data-pane={pane} onDragOver={handleDragOver} onDrop={handleDrop}>
      {sessions.map((session, index) => renderTab(session, index))}
      {dragOverIndex === sessions.length && draggedId !== null && (
        <div className="tab-drop-indicator" />
      )}
      {showSettingsTab && (
        <>
          {sessions.length > 0 && (
            <div className="tab-settings-divider" />
          )}
          <div
            className={`tab settings-tab ${activeView === "settings" ? "active" : ""}`}
            onClick={onSelectSettings}
          >
          <span className="tab-icon">
            <SettingsIcon size={14} />
          </span>
          <span className="tab-title">Settings</span>
          <button
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation();
              onCloseSettings?.();
            }}
          >
            <CloseIcon size={12} />
          </button>
          </div>
        </>
      )}
    </div>
  );
}

