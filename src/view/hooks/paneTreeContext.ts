// L5 — 把 usePaneTree 状态通过 Context 向下分发。
// PaneChrome / SplitContainer / TabBar 都从 context 拿,避免 props drilling。

import { createContext, useContext } from "react";

import type { PaneTreeApi } from "./usePaneTree";

const PaneTreeContext = createContext<PaneTreeApi | null>(null);

export const PaneTreeProvider = PaneTreeContext.Provider;

export function usePaneTreeContext(): PaneTreeApi {
  const ctx = useContext(PaneTreeContext);
  if (!ctx) {
    throw new Error("usePaneTreeContext must be used inside PaneTreeProvider");
  }
  return ctx;
}
