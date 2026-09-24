/**
 * Session domain — pure derived queries on the runtime `Session` shape.
 *
 * These helpers never mutate. They exist so consumers (rules, use
 * cases, bridges) can branch on transport without re-deriving the same
 * narrowing in five places.
 */
import type {
  LocalSessionConfig,
  SSHSessionConfig,
  Session,
  SessionConnectionType,
  TmuxCcConfig,
} from "./types";

/** Narrow a session to a local-PTY session by transport type. */
export function isLocalSession(
  session: Session,
): session is Session & { sessionType: { type: "local"; config: LocalSessionConfig } } {
  return session.type === "local";
}

/** Narrow a session to an SSH session by transport type. */
export function isSshSession(
  session: Session,
): session is Session & { sessionType: { type: "ssh"; config: SSHSessionConfig } } {
  return session.type === "ssh";
}

/** Narrow a session to a tmux control-mode session by transport type. */
export function isTmuxCcSession(
  session: Session,
): session is Session & { sessionType: { type: "tmux-cc"; config: TmuxCcConfig } } {
  return session.type === "tmux-cc";
}

/** Compile-time helper for inferring the per-transport config of a session. */
export type SessionTypeOf<T extends SessionConnectionType> = T extends "local"
  ? LocalSessionConfig
  : T extends "ssh"
    ? SSHSessionConfig
    : T extends "tmux-cc"
      ? TmuxCcConfig
      : never;
