# Settings Refactor Findings

## Current Architecture

### Settings Entry Point
- Currently accessed via the Settings (gear) button in `SidebarToolbar`.
- Opens `SettingsPanel` as a sidebar submenu (`src/components/sidebar/SettingsPanel.tsx`).
- Contains collapsible sections: Appearance, Shortcuts, About.

### Tab Bar
- `TabBar.tsx` renders one tab per active `Session`.
- Tabs support selection, middle-click close, rename, and close button.
- No concept of non-session or persistent tabs.

### Sidebar
- `Sidebar.tsx` hosts `SidebarToolbar` and either `SessionManager` or `SettingsPanel`.
- `SidebarToolbar.tsx` has top section (Chat, Logs) and bottom section (Settings).

### Layout
- `AppLayout.tsx` orchestrates NavBar, Sidebar, TabBar, TerminalContainer, CommandSendPanel, and CreateSessionDialog.
- `activeSessionId` is typed as `number | null` and tracks the active session.

## Proposed Architecture

### Tab Model
- Add a persistent, non-closable "Settings" tab to the right of session tabs.
- Track `activeView: 'terminal' | 'settings'` in `AppLayout`.
- When a session tab is selected: `activeView = 'terminal'` and `activeSessionId` updates.
- When Settings tab is selected: `activeView = 'settings'`.

### Settings Page
- New `SettingsView` component rendered inside `main-area` when `activeView === 'settings'`.
- Layout: left `settings-index` (secondary toolbar) + right `settings-content`.
- Directory index items: Appearance, Shortcuts, About.
- Selecting an item shows the corresponding content.

### Sidebar Changes
- Remove the Settings button from `SidebarToolbar`.
- Remove Settings rendering branch from `Sidebar`.
- Keep Chat/Logs buttons unchanged.

### Styling
- Reuse existing CSS variables (`--bg-secondary`, `--bg-primary`, `--text-secondary`, etc.).
- Add new classes for settings view, index, content, and active index item.

## Files to Modify
1. `src/components/TabBar.tsx` - add persistent Settings tab support
2. `src/components/AppLayout.tsx` - track `activeView`, render `SettingsView`
3. `src/components/sidebar/Sidebar.tsx` - remove Settings branch
4. `src/components/sidebar/SidebarToolbar.tsx` - remove Settings button
5. `src/components/settings/SettingsView.tsx` - new component (replaces SettingsPanel)
6. `src/components/settings/SettingsView.css` - new styles
7. `src/components/sidebar/SettingsPanel.tsx` - delete (content moved to SettingsView)
8. `src/styles/layout.css` - add/adjust settings layout helpers if needed

## Risks
- Active session logic must not regress when switching to/from Settings.
- CommandSendPanel should probably be hidden when Settings is active.
- Empty state should not appear when Settings is active and no sessions exist.
