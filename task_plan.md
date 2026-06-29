# Task Plan: Refactor Settings into a Tab Page with Directory Index

## Goal
Refactor the settings UI so that Settings becomes a tab in the main tab bar, and the settings page uses a left-side secondary toolbar as a directory index for categories. The Settings tab is hidden by default and only appears after clicking the Settings button in the sidebar.

## Current Phase
Phase 2

## Phases

### Phase 1: Requirements & Discovery
- [x] Inventory settings, tab bar, sidebar, and layout components
- [x] Read current `SettingsPanel.tsx`, `TabBar.tsx`, `Sidebar.tsx`, `SidebarToolbar.tsx`, `AppLayout.tsx`
- [x] Document findings and design decisions
- **Status:** complete

### Phase 2: Implementation
- [x] Add conditional Settings tab to `TabBar` (hidden by default)
- [x] Create `SettingsView` component with left directory index and category content
- [x] Update `AppLayout` to switch between terminal view and settings view
- [x] Restore Settings button in `SidebarToolbar` / `Sidebar`
- [x] Remove left-side settings directory index; render all categories vertically
- [x] Update `SettingsView.tsx` and `SettingsView.css` accordingly
- [x] Delete or repurpose `SettingsPanel.tsx`
- **Status:** complete

### Phase 3: Verification
- [x] Run `npm run build` and ensure zero TypeScript errors
- [x] Check for visual regressions in tab bar and sidebar
- [x] Document verification results in `progress.md`
- **Status:** complete

### Phase 4: Delivery
- [x] Summarize changes
- [x] Deliver to user
- **Status:** complete

## Key Questions
1. Should the Settings tab always be visible? (No - hidden by default, shown after clicking sidebar Settings button)
2. What categories should the directory index include? (Appearance, Shortcuts, About - matching current settings)
3. Should the existing sidebar Settings button be removed? (No - restored as the trigger to show the Settings tab)

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Settings tab hidden by default | User wants Settings tab page only shown after clicking Settings button |
| Sidebar Settings button restored | User explicitly asked to restore the original Settings button |
| Clicking Settings button shows tab + switches view | Provides clear navigation feedback |
| Left secondary toolbar as directory index | User explicitly wants secondary toolbar as category index |
| Reuse existing Appearance/Shortcuts/About content | Keep behavior unchanged, only change navigation shell |
| `activeView` state in AppLayout | Cleaner than overloading `activeSessionId` with string sentinel |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
|       |         |            |

## Notes
- Current settings lives in `src/components/settings/SettingsView.tsx` as a tab page.
- Tab bar currently renders sessions + persistent Settings tab; needs to conditionally render Settings tab.
- Sidebar toolbar currently has Chat and Logs buttons; Settings button needs to be restored.

