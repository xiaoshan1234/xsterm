/**
 * Tmux bridge — wires Tauri tmux-* events to the tmux + session
 * stores.
 *
 * **Skeleton in Commit 3**: subscribes to every tmux-* event
 * and logs them at debug level. Commit 4 wires the actual
 * mutations: tmux-pane-added → addSession, tmux-window-added →
 * addWindow, tmux-controller-exit → setTmuxControllerError, etc.
 *
 * **Cross-service writes happen here, not in tmux/actions.ts** —
 * this is the only file in `service/tmux/` that may import from
 * `service/session/*`.
 *
 * **Render**: returns `null`. Mount once at the top of the
 * React tree.
 */
import { useEffect } from "react";
import { infraEventBus } from "../../infra/tauri/eventBus";
import type {
  TmuxPaneAddedEvent,
  TmuxPaneRemovedEvent,
  TmuxWindowAddedEvent,
  TmuxWindowClosedEvent,
  TmuxWindowRenamedEvent,
} from "../../model";
import { useLogger } from "../logger/useLogger";

export function TmuxBridge(): null {
  const logger = useLogger();
  useEffect(() => {
    const unsubs: Array<() => void> = [];

    unsubs.push(
      infraEventBus.subscribe<TmuxPaneAddedEvent>("tmux-pane-added", (event) => {
        logger.debug("tmuxBridge", "tmux-pane-added", event);
      }),
    );
    unsubs.push(
      infraEventBus.subscribe<TmuxPaneRemovedEvent>("tmux-pane-removed", (event) => {
        logger.debug("tmuxBridge", "tmux-pane-removed", event);
      }),
    );
    unsubs.push(
      infraEventBus.subscribe<TmuxWindowAddedEvent>("tmux-window-added", (event) => {
        logger.debug("tmuxBridge", "tmux-window-added", event);
      }),
    );
    unsubs.push(
      infraEventBus.subscribe<TmuxWindowClosedEvent>("tmux-window-closed", (event) => {
        logger.debug("tmuxBridge", "tmux-window-closed", event);
      }),
    );
    unsubs.push(
      infraEventBus.subscribe<TmuxWindowRenamedEvent>("tmux-window-renamed", (event) => {
        logger.debug("tmuxBridge", "tmux-window-renamed", event);
      }),
    );
    unsubs.push(
      infraEventBus.subscribe<{
        controller_id: number;
        windows: Array<{
          tmux_window_id: string;
          xsterm_window_id?: number;
          xsterm_session_id?: number;
          xsterm_pane_id?: string;
          name: string;
        }>;
      }>("tmux-window-list", (event) => {
        logger.debug("tmuxBridge", "tmux-window-list", { controllerId: event.controller_id });
      }),
    );
    unsubs.push(
      infraEventBus.subscribe<{ controllerId: number; reason?: string }>(
        "tmux-controller-exit",
        (event) => {
          logger.debug("tmuxBridge", "tmux-controller-exit", event);
        },
      ),
    );

    return () => {
      for (const un of unsubs) un();
    };
  }, [logger]);

  return null;
}
