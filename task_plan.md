# XSTerm Frontend Refactoring Plan

## Goal
Improve the frontend architecture of `src/` by eliminating duplication, enforcing clear layers, and making components reusable and maintainable.

## Scope
Focus on the React/TypeScript frontend (`src/`). The Tauri Rust backend (`src-tauri/src/`) is already reasonably layered; only frontend-facing type alignment will be touched.

## Phases

### Phase 1 — Consolidate cross-cutting utilities
- Merge duplicate keyboard-shortcut hooks (`useShortcut` + `useKeyboardShortcut`) into a single canonical hook.
- Remove or fix the broken `KeyboardContext` (it calls a hook inside a callback).
- Merge duplicate logger implementations (`useLogger` hook + `LoggerContext`) into one provider-based logger; remove the unused hook.
- Update `App.tsx` to use the consolidated utilities.

### Phase 2 — Extract reusable UI primitives
- Create an `Icon` component/system and replace all inline SVGs in `Sidebar`, `TabBar`, and dialogs.
- Create a `Dialog` primitive (overlay + header + content + footer) and reuse it for `CreateSessionDialog` and the inline "New Group" dialog in `Sidebar`.
- Create a `FormField` primitive for label + input/select pairs.

### Phase 3 — Split SessionContext into layered services
- Extract persistence layer: `services/sessionStorage.ts` for saved configs and groups (wraps Tauri store).
- Extract session lifecycle service: `services/sessionService.ts` for invoke calls (`create_local_session`, `create_ssh_session`, etc.).
- Refactor `SessionContext` to orchestrate state only, delegating storage and I/O to services.
- Deduplicate `createLocalSession` / `createSshSession` / `openFromConfig` with a shared session-builder helper.

### Phase 4 — Split oversized components
- Move shortcut definitions out of `App.tsx` into `hooks/useAppShortcuts.ts`.
- Extract `EmptyState` and `TerminalContainer` from `App.tsx`.
- Split `Sidebar.tsx` into toolbar, session-manager panel, settings panel, and resize-handle sub-components.
- Split `CreateSessionDialog.tsx` into local form, SSH form, and validation helpers.

### Phase 5 — Align types and organize styles
- Align frontend `SSHSessionConfig` shape with backend `SSHAuth` serialization.
- Remove unused types (`CreateSessionConfig`).
- Split `App.css` into component-scoped CSS files under `components/*.css` and shared tokens under `styles/`.

### Phase 6 — Verify
- Run `tsc --noEmit` and `vite build`.
- Fix any type errors introduced by refactoring.
- Do a quick manual smoke-test checklist (build only; runtime QA limited).

## Files to Create
- `src/hooks/useShortcut.ts` (canonical, replaces the two hooks)
- `src/hooks/useAppShortcuts.ts`
- `src/services/sessionStorage.ts`
- `src/services/sessionService.ts`
- `src/components/icons/Icon.tsx` and icon components
- `src/components/ui/Dialog.tsx`
- `src/components/ui/FormField.tsx`
- `src/components/sidebar/*.tsx` (split Sidebar)
- `src/components/dialogs/*.tsx` (split CreateSessionDialog)
- `src/components/AppLayout.tsx`
- `src/components/EmptyState.tsx`
- `src/components/TerminalContainer.tsx`
- `src/styles/tokens.css`, `src/styles/global.css`
- Per-component CSS files

## Files to Modify
- `src/App.tsx`
- `src/App.css`
- `src/contexts/SessionContext.tsx`
- `src/contexts/LoggerContext.tsx`
- `src/contexts/KeyboardContext.tsx`
- `src/types/session.ts`
- `src/components/Sidebar.tsx`
- `src/components/TabBar.tsx`
- `src/components/CreateSessionDialog.tsx`
- `src/components/Terminal.tsx`

## Files to Remove
- `src/hooks/useKeyboardShortcut.ts`
- `src/hooks/useLogger.ts` (logic moves into LoggerContext or a single logger hook)

## Success Criteria
- `npm run build` passes with no TypeScript errors.
- No remaining obvious duplication (shortcut hooks, logger, icons, session creation).
- `SessionContext` is under 200 lines and delegates storage/I/O.
- `App.tsx` is under 50 lines and only wires providers + layout.
- No React hooks rule violations (KeyboardContext fixed).
