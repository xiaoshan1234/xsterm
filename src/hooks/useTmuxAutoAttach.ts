import { useEffect, useRef } from "react";
import { autoAttachTmuxServers } from "../services/sessionService";

/**
 * re-attach every persisted `attachedTmuxServers` entry on
 * app mount. The backend's `auto_attach_tmux_servers` Tauri command
 * does the heavy lifting (load + re-attach + persist); we just
 * dispatch it and log partial failures to the console.
 *
 * Triggers exactly once across the lifetime of the app because React
 * strict-mode double-mounts the SessionProvider in dev. Use a ref
 * (not state) so the mount-cycle doesn't re-run this.
 */
export function useTmuxAutoAttach(): void {
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    autoAttachTmuxServers()
      .then((results) => {
        if (results.length === 0) return;
        const succeeded = results.filter((r) => r.info !== undefined).length;
        const failed = results.length - succeeded;
        console.info(`[xsterm] auto-attach: ${succeeded} succeeded, ${failed} failed`, results);
      })
      .catch((err) => {
        console.warn("[xsterm] autoAttachTmuxServers failed:", err);
      });
  }, []);
}
