/**
 * Tmux domain — event subscription contract for tmux bridge events.
 *
 * Mirrors the surface of the existing
 * `infra/tauri/events/tmuxEvents.ts` listeners, typed so the
 * `TmuxModel` can subscribe without importing Tauri directly. The
 * auto-attach outcome subscription lives here too because the
 * payload shape is tmux-specific.
 */
import type { Unsubscribe } from "../session/events";
import type {
  AutoAttachOutcome,
  TmuxControllerExitEvent,
  TmuxPaneAddedEvent,
  TmuxPaneRemovedEvent,
  TmuxWindowAddedEvent,
  TmuxWindowClosedEvent,
  TmuxWindowListEntry,
  TmuxWindowRenamedEvent,
} from "./types";

export type { Unsubscribe };

export type TmuxPaneAddedHandler = (event: TmuxPaneAddedEvent) => void;
export type TmuxPaneRemovedHandler = (event: TmuxPaneRemovedEvent) => void;
export type TmuxWindowAddedHandler = (event: TmuxWindowAddedEvent) => void;
export type TmuxWindowClosedHandler = (event: TmuxWindowClosedEvent) => void;
export type TmuxWindowRenamedHandler = (event: TmuxWindowRenamedEvent) => void;
export type TmuxWindowListHandler = (controllerId: number, entries: TmuxWindowListEntry[]) => void;
export type TmuxControllerExitHandler = (event: TmuxControllerExitEvent) => void;
export type TmuxPausedHandler = (event: { tmuxPaneId: string }) => void;
export type TmuxContinuedHandler = (event: { tmuxPaneId: string }) => void;
export type AutoAttachOutcomeHandler = (outcome: AutoAttachOutcome) => void;

export interface TmuxEventBus {
  onPaneAdded(handler: TmuxPaneAddedHandler): Unsubscribe;
  onPaneRemoved(handler: TmuxPaneRemovedHandler): Unsubscribe;
  onWindowAdded(handler: TmuxWindowAddedHandler): Unsubscribe;
  onWindowClosed(handler: TmuxWindowClosedHandler): Unsubscribe;
  onWindowRenamed(handler: TmuxWindowRenamedHandler): Unsubscribe;
  onWindowList(handler: TmuxWindowListHandler): Unsubscribe;
  onControllerExit(handler: TmuxControllerExitHandler): Unsubscribe;
  onPaused(handler: TmuxPausedHandler): Unsubscribe;
  onContinued(handler: TmuxContinuedHandler): Unsubscribe;
  onAutoAttachOutcome(handler: AutoAttachOutcomeHandler): Unsubscribe;
}
