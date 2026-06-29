# Settings Refactor Progress Log

## 2026-06-29
- Received request to refactor settings into a tab page with secondary toolbar directory index.
- Inventoried relevant components: `SettingsPanel.tsx`, `TabBar.tsx`, `Sidebar.tsx`, `SidebarToolbar.tsx`, `AppLayout.tsx`, `SessionContext.tsx`, theme/icons.
- Created `task_plan.md`, `findings.md` with proposed architecture.
- Decision: use `activeView: 'terminal' | 'settings'` in `AppLayout` instead of overloading `activeSessionId`.
- Implementation complete:
  - Added `SettingsView` component (`src/components/settings/SettingsView.tsx` + `.css`) with left directory index (Appearance, Shortcuts, About).
  - Added persistent Settings tab to `TabBar` using `SettingsIcon`; tab cannot be closed or renamed.
  - Updated `AppLayout` to switch between terminal view and Settings view via `activeView` state.
  - Removed Settings button/menu from `SidebarToolbar` and `Sidebar`; deleted `SettingsPanel.tsx`.
  - `npm run build` passes with zero TypeScript errors.
- Verification: manually reviewed changed files; build confirmed clean.

## 2026-06-29 (Settings tab visibility update)
- User requested: restore original Settings button and keep Settings tab hidden by default; only show after clicking Settings button.
- Implementation changes:
  - Restored Settings button in `SidebarToolbar` (bottom section).
  - Added `settingsActive` prop to `Sidebar` so the Settings button highlights while Settings is open.
  - `Sidebar` now routes Settings button click to `onOpenSettings` callback instead of toggling a submenu.
  - `AppLayout` tracks `settingsTabVisible` state (default `false`); clicking Settings button sets it to `true` and switches to settings view.
  - `TabBar` receives `showSettingsTab` and `onCloseSettings`; Settings tab is conditionally rendered and has a close button.
  - Closing the Settings tab hides it and returns to terminal view.
- Verified `npm run build` passes with zero TypeScript errors.

## 2026-06-29 (Remove settings directory index)
- User requested removing the left-side settings directory index (`settings-index`).
- Updated `SettingsView.tsx` to render Appearance, Shortcuts, and About sections vertically in a single scrollable content area.
- Removed `settings-index` and `settings-index-item` styles from `SettingsView.css`.
- Verified `npm run build` passes with zero TypeScript errors.

## 2026-06-29 (Decouple settings from subsidebar state)
- User requested: opening Settings page should not affect the subsidebar (Session Manager) state.
- Changed `Sidebar` so that Settings activation is purely visual (button highlight) and does not change `activeMenu` state.
- `activeMenu` now only tracks the actual subsidebar panel (`chat`); Settings button highlight is driven by the `settingsActive` prop passed from `AppLayout`.
- Removed the `useEffect` that used to sync `activeMenu` with `settingsActive`, and stopped setting `"settings"` into `activeMenu` state.
- Verified `npm run build` passes with zero TypeScript errors.

## 2026-06-29 (Theme selector dropdown)
- User requested: replace the theme button list with a dropdown select.
- Updated `SettingsView.tsx` Appearance section to use a native `<select>` dropdown.
- Added a small theme color preview circle next to the dropdown.
- Replaced `.settings-theme-list` / `.settings-theme-item` styles with `.settings-theme-field` / `.settings-theme-select-wrapper` / `.settings-theme-select` styles.
- Verified `npm run build` passes with zero TypeScript errors.

## 2026-06-29 (Settings subsidebar index)
- User requested: when clicking Settings button, the subsidebar should switch to display the Settings category index.
- Updated `Sidebar.tsx` to render a Settings submenu (Appearance, Shortcuts, About) when `settingsActive` is true.
- Added `activeSettingsCategory` and `onSelectSettingsCategory` props to `Sidebar`.
- Updated `AppLayout.tsx` to track `activeSettingsCategory` state and pass it down.
- Updated `SettingsView.tsx` to accept `activeCategory` prop and render only the selected category.
- Clicking a category in the subsidebar switches the Settings view accordingly.
- Verified `npm run build` passes with zero TypeScript errors.

## 2026-06-29 (Toolbar toggles subsidebar)
- User requested: clicking a toolbar button opens its corresponding subsidebar; if already open, closes it; if a different subsidebar is open, switches to the new one.
- Replaced separate `settingsActive` / `activeMenu` state with a single `sidebarPanel` state in `AppLayout` (`"chat" | "settings" | null`).
- Updated `Sidebar` to receive `sidebarPanel` and `onSidebarPanelChange` props; toolbar clicks now toggle/switch the panel directly.
- Updated `SidebarToolbar` so both Chat and Settings buttons use the same `onMenuClick` toggle behavior.
- Closing the Settings tab now also clears `sidebarPanel`.
- Verified `npm run build` passes with zero TypeScript errors.

## 2026-06-29 (Tab close does not close subsidebar)
- User requested: closing the Settings tab should not close the subsidebar.
- Removed `setSidebarPanel(null)` from `onCloseSettings` in `AppLayout.tsx`.
- Now closing the Settings tab only hides the tab and switches the main view back to terminal; the Settings subsidebar remains open.
- Verified `npm run build` passes with zero TypeScript errors.

## 2026-06-29 (Global local echo toggle)
- User requested: add a global local-echo switch in Settings to avoid doubled characters when the remote already echoes input.
- Added `globalLocalEcho` state to `SessionContext`, persisted via Tauri store (`settings.json`).
- Added `getEffectiveLocalEcho(sessionId)` to the context; returns per-session override if present, otherwise the global value.
- Updated `Terminal.tsx` `handleData` to write typed characters to the terminal immediately when local echo is enabled.
- Added a "Global local echo" checkbox in `SettingsView` under Appearance.
- Left the per-session override map (`sessionLocalEchoOverrides`) in place for future per-session toggles.
- Verified `npm run build` passes with zero TypeScript errors.

## 2026-06-29 (Fix local echo stale closure)
- Issue: local echo state read inside `Terminal.tsx` `handleData` was stale because `handleData` was memoized without updating when `localEchoEnabled` changed.
- Replaced direct `localEchoEnabled` read in `handleData` with a ref (`localEchoEnabledRef`) that is updated on every state change.
- This ensures the toggle takes effect immediately for existing terminal instances without recreating them.
- Verified `npm run build` passes with zero TypeScript errors.

## 2026-06-29 (Fix local echo always showing double)
- Issue: even with local echo off, typed characters appeared twice (remote echo + something else).
- Root cause: the memoized `handleData` callback was still registered on xterm from the initial render, so it captured the initial `localEchoEnabledRef` value and never updated.
- Fix: removed the separate `handleData` callback and registered xterm's `onData` handler inline inside the effect. It reads the latest ref value directly and writes to xterm only when local echo is enabled.
- Verified `npm run build` passes with zero TypeScript errors.

## 2026-06-29 (Deduplicate xterm onData events)
- Issue: typing one character showed 2 chars when local echo was off and 3 chars when on.
- Root cause: on the current Tauri webview, xterm.js fires `onData` twice for a single keystroke (both keydown and keypress paths), causing each character to be sent to the backend twice and echoed back twice.
- Fix: added a short deduplication guard in `Terminal.tsx` `handleData` that ignores identical input within 30ms.
- Also hardened the `session-output` / `tmux-pane-output` listener cleanup so async listener registration is properly torn down if the effect unmounts before `listen()` resolves.
- Verified `npm run build` passes with zero TypeScript errors.
