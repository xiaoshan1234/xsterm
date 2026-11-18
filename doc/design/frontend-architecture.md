# Frontend Architecture

This document defines the target frontend architecture for xsterm. It records
the migration from the former aggregate `src/features/sessions` boundary and
the remaining compatibility work.

## Core boundaries

| Concern              | Owns                                              | Must not own                             |
| -------------------- | ------------------------------------------------- | ---------------------------------------- |
| `LaunchConfig`       | Saved Local, SSH, and tmux launch settings        | Running connections or pane layout       |
| `TerminalSession`    | One live non-tmux terminal connection             | Saved-config forms or Workspace layout   |
| `TerminalStream`     | Write, resize, close, and output subscription     | Window and Pane topology                 |
| `TmuxController`     | One tmux control connection and its windows/panes | Raw xterm rendering or Workspace storage |
| `Workspace`          | Window order and Pane layout references           | Backend connection ownership             |
| `TerminalSurface`    | xterm rendering, input, paste, and resize         | Domain state mutation                    |
| Session coordination | Cross-aggregate use cases                         | Domain rules owned by a feature          |

The word `Session` should not be used as a public aggregate name. Use the
specific domain term above.

## Dependency direction

```text
app
  -> features
  -> shared/ui

features
  -> models
  -> shared
  -> feature-local application ports

infrastructure
  -> application ports and normalized contracts

models
  -> models only

shared
  -> shared only
```

Feature internals are private. Cross-feature imports must go through the owning
feature's `index.ts`.

UI components call intent-level application actions. They must not call Tauri
commands, subscribe to raw Tauri events, consume backend DTOs, or coordinate
multiple reducers directly.

## Target directory shape

```text
src/
  app/
    application/
    infrastructure/
    shell/
  features/
    launch-config/
    terminal/
    terminal-stream/
    terminal-surface/
    tmux/
    workspace/
    command-sender/
    settings/
  models/
  infra/
    logging/
    storage/
  shared/
  test/
  styles/
```

Directories are introduced only when they contain code. Each feature may use
the relevant subset of:

```text
application/
infrastructure/
persistence/
state/
selectors/
viewModels/
ui/
index.ts
```

## Stable API rules

- Public feature contracts use business IDs and normalized camelCase values.
- Public contracts never expose `MutableRefObject`, React setters, Tauri DTOs,
  command names, or backend handles.
- Multi-argument actions use explicit command objects instead of positional
  booleans.
- Expected business failures use a stable error code. UI must not inspect
  `error.message` to determine behavior.
- Model and reducer functions are pure. React, Tauri, DOM, logging, and storage
  belong to the edges.
- Tauri event adapters normalize snake_case payloads before producing domain
  events.

## Cross-aggregate flows

Cross-aggregate operations belong in `app/application`, not in a UI component
or a feature reducer. For example:

```text
open saved config
  -> launch-config application
  -> terminal or tmux application
  -> workspace application
  -> coordinator updates the owning feature states
```

The coordinator sequences use cases. It does not duplicate model invariants.

## Test contract

| Layer                   | Test dependency                                       |
| ----------------------- | ----------------------------------------------------- |
| Models and reducers     | No React or Tauri                                     |
| Application use cases   | Fake ports, clock, and ID generator                   |
| Infrastructure adapters | Fake `invoke` and `listen` functions                  |
| UI                      | `createTestApplication()` with fake application ports |
| End-to-end              | A small set of real Tauri/tmux flows                  |

Tests should not mock an entire feature entry point. They should replace the
small port that the use case or component consumes.

## Migration sequence

1. Stabilize error and command contracts.
2. Extract pure event transitions and terminal/tmux event routing.
3. Move saved launch configurations and persistence into `launch-config`.
4. Move Terminal lifecycle state into `terminal-runtime`.
5. Move tmux controller topology into `tmux`.
6. Move Workspace and Window/Pane snapshots into `workspace`.
7. Convert xterm integration to the `TerminalStreamPort` contract.
8. Keep `features/sessions` and `useSession()` removed, then replace the
   former `models/runtime` compatibility namespace with feature-scoped
   terminal and launch model contracts.

Each step should be independently testable and must preserve persisted data and
Tauri event compatibility.

## Migration status

- Completed: typed application errors and code-based UI handling.
- Completed: editable PaneTree operations live under
  `features/workspace/application`, while canonical workspace invariants stay
  in `models/workspace`.
- Completed: saved launch configs, groups, defaults, schema migration, and
  persistence now live under `features/launch-config`.
- Completed: launch-config group operations are pure functions, and launch
  config loading/persistence is owned by a `launch-config` application hook.
- Completed: launch-config, terminal-runtime, workspace, and preference
  contexts are owned by their features and expose only narrow hooks.
- Completed: cross-aggregate session orchestration lives in
  `app/application/session`; `features/sessions` has been removed.
- Completed: terminal and tmux events are subscribed by feature-local bridges.
- Completed: cross-aggregate tmux event coordination lives in
  `app/application/session`; tmux feature provides the event stream adapter.
- Completed: PaneTree/workspace transitions and tmux layout parsing live in
  their owning features.
- Completed: terminal session/stream actions are feature application
  contracts; `app/application/session` no longer imports feature infrastructure.
- Completed: terminal lifecycle orchestration is split into local/SSH creation,
  tmux lifecycle, and terminal maintenance application hooks.
- Completed: xterm rendering and interaction live in the independent
  `terminal-surface` feature.
- Completed: workspace UI, dialogs, window actions, and persistence hooks are
  organized under `features/workspace/{ui,application,persistence,state}`.
- Completed: Terminal and tmux configuration dialogs now live under
  `features/launch-config/ui`; runtime-only terminal selection lives with the
  workspace Pane UI that consumes it.
- Completed: both terminal and tmux adapters consume the shared
  `terminal-stream` wire contracts instead of depending on terminal
  infrastructure internals.
- Completed: feature root indexes expose their cross-feature UI and view-model
  API, and ESLint rejects app or feature imports that bypass those entries.
- Completed: Pane attach, split, close, and tmux-window actions are intent ports
  implemented by the app coordinator; Pane UI no longer mutates multiple
  feature reducers.
- Completed: AppShell modal rendering is isolated in `RuntimeOverlays`, leaving
  `AppShellRuntime` responsible for shell state and feature composition.
- Completed: `createTestApplication()` provides the feature Provider stack and
  allows per-context fake overrides for UI tests.
- Completed: all existing React Hook dependency warnings are resolved without
  suppressing rules.
- Completed: terminal-surface output, clipboard, and paste write services are
  injectable ports with production defaults.
- Completed: feature UI is lint-restricted from infrastructure adapters and
  Tauri plugins.
- Completed: the `models/runtime` compatibility namespace has been retired.
- Completed: frontend terminal projections and capability flags are owned by
  `features/terminal/contracts.ts`; `models/terminal` contains canonical domain
  types only.
- Completed: editable pane/window/workspace projections live in
  `features/workspace/contracts.ts`; canonical aggregates remain isolated in
  `models/workspace`.
- Completed: `TmuxSessionConfig`, saved terminal configurations, local/SSH
  connection inputs, and display settings live in
  `features/launch-config/contracts.ts`.
- Completed: terminal and tmux runtime contexts are separate; tmux lifecycle
  and controller errors are no longer exposed through terminal contracts.
- Completed: terminal close/workspace removal coordination and tmux resize
  effects are injected from the app layer rather than imported from other
  feature actions.
- Completed: terminal events are normalized by the terminal feature and
  coordinated into terminal/workspace state by `app/application/session`.
- Completed: shell Dialog submission orchestration is isolated in the app
  application layer; `RuntimeOverlays` only renders overlays.
- Completed: launch-config dialogs are grouped under `terminal/`, `tmux/`, and
  `groups/`.
- Completed: AppShell manager composition and workspace main area are split into
  app runtime components.
