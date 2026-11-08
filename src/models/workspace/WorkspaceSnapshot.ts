import {
  type LaunchConfigId,
  type PaneId,
  type TmuxWindowId,
  type WindowId,
  type WorkspaceId,
} from "../ids";
import { type RawPaneDirection } from "./RawPaneTree";

/**
 * Persisted layout format. Runtime-only ids such as TerminalId,
 * TerminalStreamId and TmuxControllerId are intentionally absent.
 */
export interface WorkspaceSnapshot {
  readonly version: 1;
  readonly id: WorkspaceId;
  readonly name: string;
  readonly activeWindowId: WindowId;
  readonly windows: readonly WorkspaceWindowSnapshot[];
}

export type WorkspaceWindowSnapshot = RawWindowSnapshot | TmuxWindowReferenceSnapshot;

export interface RawWindowSnapshot {
  readonly kind: "raw-window";
  readonly id: WindowId;
  readonly name: string;
  readonly activePaneId: PaneId;
  readonly layout: RawPaneNodeSnapshot;
}

export interface TmuxWindowReferenceSnapshot {
  readonly kind: "tmux-window-reference";
  readonly id: WindowId;
  /** Persist the launch config that can recreate/attach this controller. */
  readonly controllerConfigId: LaunchConfigId;
  readonly tmuxWindowId: TmuxWindowId;
}

export type RawPaneNodeSnapshot = RawPaneLeafSnapshot | RawPaneSplitSnapshot;

export interface RawPaneLeafSnapshot {
  readonly kind: "leaf";
  readonly id: PaneId;
  readonly content:
    | { readonly kind: "empty" }
    | {
        readonly kind: "terminal";
        /** Runtime `TerminalId` is intentionally replaced by its launch config. */
        readonly configId: LaunchConfigId;
      };
}

export interface RawPaneSplitSnapshot {
  readonly kind: "split";
  readonly id: PaneId;
  readonly direction: RawPaneDirection;
  readonly ratio: number;
  readonly children: readonly [RawPaneNodeSnapshot, RawPaneNodeSnapshot];
}
