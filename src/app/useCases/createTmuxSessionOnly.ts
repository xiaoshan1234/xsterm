/**
 * createTmuxSessionOnly — create a tmux session without auto-creating
 * any xsterm window. Used by PaneInitCard / split flows.
 */
import * as tmuxTauri from "../../infra/tauri/commands/tmux";
import { logger } from "../../infra/logger/logger";
import { useSessionStore } from "../../service/session/store";
import { usePersistenceStore } from "../../service/persistence/store";
import { buildFrontendSession } from "../../app/rules/sessionRules";
import { generateId } from "../../app/rules/paneTree";
import type {
  PersistedSessionConfig,
  Session,
  SessionDisplayConfig,
  TmuxCcConfig,
} from "../../model";

export async function createTmuxSessionOnly(
  config: TmuxCcConfig,
  shouldSave: boolean = true,
  displayConfig?: SessionDisplayConfig,
): Promise<Session> {
  const t0 = Date.now();
  const configId = generateId();
  logger.debug("createTmuxSessionOnly", "entry", {
    configId,
    tmuxSessionName: config.tmuxSessionName ?? null,
    ssh: config.ssh ? "ssh" : "local",
    shouldSave,
    hasDisplayConfig: displayConfig !== undefined,
  });

  const init = await tmuxTauri.createTmux(config);
  logger.debug("createTmuxSessionOnly", "backend init received", {
    controllerId: init.session.tmuxControllerId ?? null,
    bootstrapSessionId: init.session.id,
    bootstrapName: init.session.name,
  });

  const session = buildFrontendSession(init.session, configId, "tmux-cc", displayConfig);

  if (shouldSave) {
    const saved: PersistedSessionConfig = {
      id: configId,
      name: init.session.name,
      version: 1,
      type: "tmux-cc",
      config,
      displayConfig,
    };
    usePersistenceStore.getState().upsertSavedConfig(saved);
    logger.debug("createTmuxSessionOnly", "persisted", { savedConfigId: configId });
  }

  useSessionStore.getState().addSession(session);
  logger.debug("createTmuxSessionOnly", "done", {
    sessionId: session.id,
    elapsedMs: Date.now() - t0,
  });
  return session;
}
