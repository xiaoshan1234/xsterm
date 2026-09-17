/**
 * Auto-attach bridge — runs the startup-time
 * `auto_attach_tmux_servers` IPC once on mount and routes each
 * per-server outcome into the session / tmux stores.
 *
 * **Skeleton in Commit 3**: just calls the IPC and logs the
 * result. Commit 4 wires each outcome into the appropriate
 * store (a success populates the session store; a failure
 * surfaces the retry-banner).
 *
 * **Render**: returns `null`. Mount once at the top of the
 * React tree.
 */
import { useEffect, useRef } from "react";
import { autoAttachTmuxServers } from "../../infra/tauri/commands/tmux";
import { subscribeAutoAttachOutcome } from "../../infra/tauri/events/autoAttach";
import { useLogger } from "../logger/useLogger";

export function AutoAttachBridge(): null {
  const logger = useLogger();
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const unsubPromise = subscribeAutoAttachOutcome((outcome) => {
      logger.debug("autoAttachBridge", "auto-attach outcome", outcome);
    });

    autoAttachTmuxServers()
      .then((results) => {
        if (results.length === 0) return;
        const succeeded = results.filter((r) => r.info !== undefined).length;
        const failed = results.length - succeeded;
        logger.info("autoAttachBridge", `auto-attach: ${succeeded} succeeded, ${failed} failed`);
      })
      .catch((err) => {
        logger.warn("autoAttachBridge", "autoAttachTmuxServers failed", { err: String(err) });
      });

    let cleanup = () => {};
    void unsubPromise.then((un) => {
      cleanup = un;
    });

    return () => cleanup();
  }, [logger]);

  return null;
}
