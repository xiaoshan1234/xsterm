import { type TmuxControllerId, type TmuxPaneId, type TmuxWindowId } from "../ids";
import { type TmuxPane } from "./TmuxPane";

/**
 * Domain events produced after infra has normalized raw Tauri tmux payloads.
 * All identifiers are branded and all tmux ids refer to the frontend's current
 * controller projection.
 */
export type TmuxEvent =
  | {
      readonly kind: "tmux.controller-exited";
      readonly controllerId: TmuxControllerId;
      readonly occurredAt: number;
      readonly reason?: string;
    }
  | {
      readonly kind: "tmux.pane-added";
      readonly controllerId: TmuxControllerId;
      readonly windowId: TmuxWindowId;
      readonly pane: TmuxPane;
      readonly occurredAt: number;
    }
  | {
      readonly kind: "tmux.pane-removed";
      readonly controllerId: TmuxControllerId;
      readonly windowId: TmuxWindowId;
      readonly paneId: TmuxPaneId;
      readonly occurredAt: number;
    }
  | {
      readonly kind: "tmux.window-added";
      readonly controllerId: TmuxControllerId;
      readonly windowId: TmuxWindowId;
      readonly occurredAt: number;
    }
  | {
      readonly kind: "tmux.window-closed";
      readonly controllerId: TmuxControllerId;
      readonly windowId: TmuxWindowId;
      readonly occurredAt: number;
    }
  | {
      readonly kind: "tmux.window-renamed";
      readonly controllerId: TmuxControllerId;
      readonly windowId: TmuxWindowId;
      readonly name: string;
      readonly occurredAt: number;
    };
