import { type TmuxControllerId, type TmuxPaneId, type TmuxWindowId } from "../ids";
import { type TmuxPane } from "./TmuxPane";

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
