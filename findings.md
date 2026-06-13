# Refactoring Findings

## Duplication

1. **Two nearly identical shortcut hooks**
   - `src/hooks/useShortcut.ts` (30 lines)
   - `src/hooks/useKeyboardShortcut.ts` (37 lines)
   - Both register a window `keydown` listener and match key + modifiers.

2. **Two identical logger implementations**
   - `src/hooks/useLogger.ts`
   - `src/contexts/LoggerContext.tsx`
   - Both log to console and call `invoke("log_message", ...)`.

3. **Duplicate icon SVGs**
   - `getConfigIcon` in `Sidebar.tsx` and `getIcon` in `TabBar.tsx` render the same local/ssh icons.
   - `Sidebar.tsx` defines 7 inline icon components (`ChatIcon`, `SettingsIcon`, `LogIcon`, `ChevronIcon`, `FolderIcon`, `CloseIcon`, `PlusIcon`).

4. **Duplicate session creation logic**
   - `createLocalSession`, `createSshSession`, and `openFromConfig` in `SessionContext.tsx` all build a `Session` object with the same shape, set active session, and append to `sessions`.
   - Only the invoke command name and saved-config payload differ.

5. **Duplicate dialog structure**
   - `CreateSessionDialog.tsx` and the inline New Group dialog in `Sidebar.tsx` both implement overlay + dialog card + header + content + footer.

## Architectural Issues

1. **`KeyboardContext` violates Rules of Hooks**
   - `registerShortcut` calls `useShortcut(config)` inside a callback. Hooks cannot be called conditionally or inside callbacks.

2. **`SessionContext` violates Single Responsibility Principle**
   - 389 lines.
   - Mixes state management, Tauri store persistence, Tauri invoke calls, group management, and active-session tracking.
   - Hard to test and reason about.

3. **`App.tsx` does too much**
   - Defines 4 shortcuts inline.
   - Renders empty-state UI, tab bar, terminal container, and dialog.
   - Should be a thin layout shell.

4. **Monolithic CSS**
   - `App.css` is 767 lines with styles for every component.
   - No co-location of styles with components.

## Type Issues

1. `CreateSessionConfig` in `src/types/session.ts` is unused.
2. Frontend `SSHSessionConfig` manually mirrors backend `SSHAuth` enum; should align explicitly with backend serialization.
3. `Session["session_type"]` is cast with `as Session["session_type"]` in multiple places instead of being typed correctly from the invoke result.

## Recommendations

- Consolidate to one shortcut hook and delete `KeyboardContext` (or rewrite it to manage a list of shortcuts without violating hook rules).
- Keep logger as a Context provider; delete the duplicate hook.
- Extract a shared `createSession` helper in `SessionContext` to remove duplication.
- Extract services for storage and Tauri invocation so context only orchestrates React state.
- Build a small icon library and dialog/form primitives.
- Split CSS alongside components.
