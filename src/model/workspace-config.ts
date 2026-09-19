import type { SavedWindow } from "./window-config";

export interface SavedWorkspace {
  id: string;
  name: string;
  windows: SavedWindow[];
}
