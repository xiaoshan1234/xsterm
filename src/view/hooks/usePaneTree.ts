// L5 — tab + PaneTree 状态机。
// 见 ARCHITECTURE §6 依赖图。
//
// 单一实例(在 App 顶层调用,通过 PaneTreeContext 向下分发)。
// 负责:
//   - tabs / activeTabId / treesByTabId 状态
//   - 创建/关闭 tab(M2:关最后 tab 自动建 start tab)
//   - 切分/关闭 leaf(close 后父 split 坍缩;根 leaf 关闭退回 init 节点)
//   - PaneInitCard 触发 initToLeaf
//   - reconnect(M2 Q3):close 旧 + spawn 新 + replaceLeafSession

import { useCallback, useRef, useState } from "react";

import {
  closeLeaf as closeLeafOp,
  collectSessions,
  createStartTree,
  findFocusedLeaf,
  focusLeaf as focusLeafOp,
  initToLeaf as initToLeafOp,
  markLeafDead as markLeafDeadOp,
  replaceLeafSession as replaceLeafSessionOp,
  splitLeaf as splitLeafOp,
  type PaneTree,
  type Tab,
  type TabId,
} from "../../data/model/pane";
import { DEFAULT_SHELL } from "../../data/model/shell";
import type { SessionId } from "../../data/model/session";
import { spawnTerminal } from "../../data/service/pty";
import { closeSession } from "../../data/service/session";

const DEFAULT_TERMINAL_ROWS = 24;
const DEFAULT_TERMINAL_COLS = 80;

export interface PaneTreeApi {
  tabs: Tab[];
  activeTabId: TabId;
  activeTree: PaneTree;
  getTree: (tabId: TabId) => PaneTree;
  activateTab: (tabId: TabId) => void;
  createTab: () => void;
  closeTab: (tabId: TabId) => Promise<void>;
  initToLeaf: (tabId: TabId) => Promise<void>;
  splitActivePane: (tabId: TabId, axis: "h" | "v") => Promise<void>;
  closeLeaf: (tabId: TabId, sessionId: SessionId) => Promise<void>;
  reconnectLeaf: (tabId: TabId, sessionId: SessionId) => Promise<void>;
  markDead: (tabId: TabId, sessionId: SessionId) => void;
  focusLeaf: (tabId: TabId, sessionId: SessionId) => void;
}

export function usePaneTree(): PaneTreeApi {
  const [tabs, setTabs] = useState<Tab[]>([{ id: 1, title: "Tab 1", shell: DEFAULT_SHELL }]);
  const [activeTabId, setActiveTabId] = useState<TabId>(1);
  const [trees, setTrees] = useState<Map<TabId, PaneTree>>(() => {
    const m = new Map<TabId, PaneTree>();
    m.set(1, createStartTree(DEFAULT_SHELL));
    return m;
  });
  const nextTabIdRef = useRef(2);

  const getTree = useCallback(
    (tabId: TabId) => trees.get(tabId) ?? createStartTree(DEFAULT_SHELL),
    [trees],
  );

  const setTree = useCallback((tabId: TabId, updater: (prev: PaneTree) => PaneTree) => {
    setTrees((prev) => {
      const m = new Map(prev);
      const current = prev.get(tabId) ?? createStartTree(DEFAULT_SHELL);
      m.set(tabId, updater(current));
      return m;
    });
  }, []);

  const activateTab = useCallback((tabId: TabId) => {
    setActiveTabId(tabId);
  }, []);

  const createTab = useCallback(() => {
    const newId = nextTabIdRef.current++;
    setTabs((prev) => {
      const newTab: Tab = {
        id: newId,
        title: `Tab ${prev.length + 1}`,
        shell: DEFAULT_SHELL,
      };
      setTrees((prevTrees) => {
        const m = new Map(prevTrees);
        m.set(newId, createStartTree(DEFAULT_SHELL));
        return m;
      });
      setActiveTabId(newId);
      return [...prev, newTab];
    });
  }, []);

  const closeTab = useCallback(
    async (tabId: TabId) => {
      const tree = trees.get(tabId);
      if (tree) {
        const sessions = collectSessions(tree.root);
        await Promise.all(sessions.map((id) => closeSession(id).catch(() => undefined)));
      }
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === tabId);
        if (idx === -1) return prev;
        const next = prev.filter((t) => t.id !== tabId);
        setTrees((prevTrees) => {
          const m = new Map(prevTrees);
          m.delete(tabId);
          if (next.length === 0) {
            // Q2:关最后 tab → 自动新建一个 start tab
            const startId = nextTabIdRef.current++;
            m.set(startId, createStartTree(DEFAULT_SHELL));
            setActiveTabId(startId);
            return m;
          }
          return m;
        });
        if (activeTabId === tabId && next.length > 0) {
          const fallback = next[Math.max(0, idx - 1)];
          if (fallback) setActiveTabId(fallback.id);
        }
        return next.length === 0
          ? [
              {
                id: nextTabIdRef.current - 1,
                title: "Tab 1",
                shell: DEFAULT_SHELL,
              },
            ]
          : next;
      });
    },
    [trees, activeTabId],
  );

  const initToLeafAction = useCallback(
    async (tabId: TabId) => {
      const tree = trees.get(tabId);
      const tab = tabs.find((t) => t.id === tabId);
      if (!tree || !tab) return;
      const focused = findFocusedLeaf(tree);
      if (focused.kind !== "init") return;
      console.debug(`[initToLeaf] spawning ${tab.shell} for tab ${tabId}`);
      try {
        const id = await spawnTerminal({
          rows: DEFAULT_TERMINAL_ROWS,
          cols: DEFAULT_TERMINAL_COLS,
          shell: tab.shell,
        });
        console.debug(`[initToLeaf] spawned session ${id} for tab ${tabId}`);
        setTree(tabId, (prev) => initToLeafOp(prev, id));
      } catch (err) {
        console.error(`[initToLeaf] spawn failed for tab ${tabId}:`, err);
      }
    },
    [trees, tabs, setTree],
  );

  const splitActivePane = useCallback(
    async (tabId: TabId, axis: "h" | "v") => {
      const tree = trees.get(tabId);
      const tab = tabs.find((t) => t.id === tabId);
      if (!tree || !tab) return;
      const focused = findFocusedLeaf(tree);
      if (focused.kind !== "leaf") return;
      try {
        const newId = await spawnTerminal({
          rows: DEFAULT_TERMINAL_ROWS,
          cols: DEFAULT_TERMINAL_COLS,
          shell: tab.shell,
        });
        setTree(tabId, (prev) => splitLeafOp(prev, focused.sessionId, axis, newId, tab.shell));
      } catch (err) {
        console.error("splitActivePane spawn failed:", err);
      }
    },
    [trees, tabs, setTree],
  );

  const closeLeafAction = useCallback(
    async (tabId: TabId, sessionId: SessionId) => {
      const tree = trees.get(tabId);
      if (!tree) return;
      setTree(tabId, (prev) => closeLeafOp(prev, sessionId));
      try {
        await closeSession(sessionId);
      } catch (err) {
        console.error("closeSession failed:", err);
      }
    },
    [trees, setTree],
  );

  const reconnectLeafAction = useCallback(
    async (tabId: TabId, sessionId: SessionId) => {
      const tree = trees.get(tabId);
      const tab = tabs.find((t) => t.id === tabId);
      if (!tree || !tab) return;
      try {
        // 幂等 close 旧 session(可能已 dead)
        await closeSession(sessionId).catch(() => undefined);
        const newId = await spawnTerminal({
          rows: DEFAULT_TERMINAL_ROWS,
          cols: DEFAULT_TERMINAL_COLS,
          shell: tab.shell,
        });
        setTree(tabId, (prev) => replaceLeafSessionOp(prev, sessionId, newId));
      } catch (err) {
        console.error("reconnect failed:", err);
      }
    },
    [trees, tabs, setTree],
  );

  const markDeadAction = useCallback(
    (tabId: TabId, sessionId: SessionId) => {
      setTree(tabId, (prev) => markLeafDeadOp(prev, sessionId));
    },
    [setTree],
  );

  const focusLeafAction = useCallback(
    (tabId: TabId, sessionId: SessionId) => {
      setTree(tabId, (prev) => focusLeafOp(prev, sessionId));
    },
    [setTree],
  );

  return {
    tabs,
    activeTabId,
    activeTree: trees.get(activeTabId) ?? createStartTree(DEFAULT_SHELL),
    getTree,
    activateTab,
    createTab,
    closeTab,
    initToLeaf: initToLeafAction,
    splitActivePane,
    closeLeaf: closeLeafAction,
    reconnectLeaf: reconnectLeafAction,
    markDead: markDeadAction,
    focusLeaf: focusLeafAction,
  };
}
