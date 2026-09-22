/**
 * createInitWindow — pure factory that builds an "init" placeholder
 * Window for fresh workspaces. Extracted from `createWindow` so the
 * init-only path is easy to mock and reuse.
 */
import { generateId } from "../../app/rules/paneTree";
import type { InitWindow, Window } from "../../model/window";

export function createInitWindow(): Window {
  const init: InitWindow = {
    id: generateId(),
    name: "New Session",
    activePaneId: null,
    kind: "init",
  };
  return init;
}
