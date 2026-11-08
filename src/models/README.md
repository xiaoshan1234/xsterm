# Frontend Domain Models

This directory contains pure frontend domain models. It must not import from
`app`, `features`, `infra`, `shared`, React, Tauri, the DOM, or the store.

## Core concepts

- `Terminal` is one local or SSH terminal stream. It owns exactly one
  terminal surface, one resolved display configuration, and can be attached to
  one pane at a time.
- `TmuxController` is one tmux control connection. It owns tmux windows and
  panes, including their layout.
- `Workspace` owns user-visible window order and layout references. It does not
  own backend connections.
- `TmuxWindowReference` links a workspace tab to a window owned by a
  `TmuxController`.

## Layout boundaries

- `DirectWindow` can contain local and SSH `Terminal` references.
- `TmuxWindowReference` cannot contain direct terminal references.
- tmux panes only appear inside their owning `TmuxController`.

These boundaries are represented by discriminated unions so that invalid
mixtures cannot be expressed in TypeScript.

## Persistence

`WorkspaceSnapshot` is intentionally separate from `Workspace`. Snapshots store
launch config ids, not runtime terminal or tmux controller ids.

Launch configuration is also split by concern:

- `LocalTerminalLaunchConfig` owns shell arguments and environment variables.
- `SshTerminalLaunchConfig` owns the full `SshConnectionConfig`, including
  authentication and connection tuning.
- `SavedLaunchConfig` stores display overrides separately from the launch
  configuration.

Runtime `TerminalTransport` only keeps the public SSH connection summary. It
must not contain passwords, private-key passphrases, or other credentials.

## Dependency rule

Models may import each other within `models`, but must not depend on any upper
application layer. Infrastructure DTOs are converted into these models by the
owning feature.
