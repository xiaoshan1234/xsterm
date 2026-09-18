/**
 * createInitWindow — pure factory that builds an "init" placeholder
 * Window for fresh workspaces. Extracted from `createWindow` so the
 * init-only path is easy to mock and reuse.
 */
import { generateId } from "../../app/rules/paneTree";
import type { Window } from "../../model";

export function createInitWindow(): Window {
  const paneId = generateId();
  return {
    id: generateId(),
    name: "New Session",
    activePaneId: paneId,
    windowType: "init",
    rootPane: { id: paneId, type: "leaf", size: 100 },
  };
}
