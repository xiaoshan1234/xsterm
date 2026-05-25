# Terminal App Enhancement Plan

## TL;DR
完善终端应用的5个功能：回显修复、窗口管理、会话持久化、主题定制、快捷键配置

## Context

### Original Goal
继续完善集成终端应用的5个功能

### What We Have
- Tauri + React + TypeScript 项目结构
- 基本的会话管理（本地Shell + SSH）
- TabBar + Sidebar UI
- xterm.js 终端渲染

### What We Need to Fix/Add
1. **终端回显问题** - xterm.js 本地回显 + PTY 回显导致双倍显示
2. **窗口管理** - 新建/关闭/切换会话
3. **会话持久化** - 保存和恢复会话配置
4. **主题定制** - 终端配色切换
5. **快捷键配置** - 全局快捷键

---

## Work Objectives

### 1. Fix Terminal Echo Issue (HIGH)

**Problem**: xterm.js has local echo enabled, PTY shell also echoes input → double characters

**Solution**: Disable xterm.js local echo with `disableLocalEcho: true` option

**Changes**:
- `src/components/Terminal.tsx`: Add `disableLocalEcho: true` to xterm config

### 2. Window Management (HIGH)

**What exists**: TabBar with session switching, close button

**What's missing**:
- Double-click tab to rename
- Keyboard shortcuts for tab navigation (Ctrl+Tab, Ctrl+Shift+Tab)
- Middle-click to close tab
- New session shortcut (Ctrl+Shift+N)

**Changes**:
- `src/components/TabBar.tsx`: Add double-click rename, middle-click close
- `src/contexts/KeyboardContext.tsx`: New - global keyboard handling
- Update `App.tsx` to include keyboard context

### 3. Session Persistence (HIGH)

**What's missing**: No save/load of session configs

**Solution**: Use `@tauri-apps/plugin-store` for local JSON storage

**Changes**:
- Add `tauri-plugin-store` to Cargo.toml
- Register plugin in `lib.rs`
- `src/contexts/SessionContext.tsx`: Save sessions to store on change, load on startup
- Add Tauri commands for store operations

**Data to persist**:
- Saved sessions (SSH hosts, local shell configs)
- Last active session
- Window size/position

### 4. Theme Customization (MEDIUM)

**What's missing**: No theme switching, hardcoded colors

**Solution**: Create theme context with preset themes

**Changes**:
- `src/contexts/ThemeContext.tsx`: New - theme state and presets
- `src/types/theme.ts`: Theme type definitions
- `src/components/Terminal.tsx`: Use theme from context
- Update Settings submenu in Sidebar for theme selection

**Preset Themes**:
- Dark (VSCode-like) - current default
- Light (Solarized light)
- Monokai
- One Dark
- Dracula

### 5. Keyboard Shortcuts Configuration (MEDIUM)

**What's missing**: No shortcut handling

**Solution**: Create keyboard context with shortcut registry

**Changes**:
- `src/contexts/KeyboardContext.tsx`: New - shortcut registry
- `src/hooks/useShortcut.ts`: New - custom hook for shortcuts
- Shortcuts settings UI in Settings

**Default Shortcuts**:
- `Ctrl+Shift+N`: New session
- `Ctrl+Tab`: Next tab
- `Ctrl+Shift+Tab`: Previous tab
- `Ctrl+W`: Close current tab
- `Ctrl+,`: Open settings

---

## Implementation Plan

### Wave 1: Echo Fix + Theme System
- [ ] 1. Fix terminal echo (Terminal.tsx - add disableLocalEcho)
- [ ] 2. Create ThemeContext and types
- [ ] 3. Update Terminal to use theme context
- [ ] 4. Add theme selector to Settings submenu

### Wave 2: Session Persistence
- [ ] 5. Add tauri-plugin-store to Cargo.toml
- [ ] 6. Register store plugin in lib.rs
- [ ] 7. Add save/load commands to Rust backend
- [ ] 8. Update SessionContext to persist sessions
- [ ] 9. Load sessions on app start

### Wave 3: Window Management Improvements
- [ ] 10. Add tab rename (double-click)
- [ ] 11. Add middle-click close
- [ ] 12. Add keyboard navigation for tabs

### Wave 4: Keyboard Shortcuts
- [ ] 13. Create KeyboardContext
- [ ] 14. Create useShortcut hook
- [ ] 15. Add shortcuts settings UI
- [ ] 16. Implement default shortcuts

### Wave 5: Integration & Polish
- [ ] 17. Wire up all contexts in App.tsx
- [ ] 18. Test all features
- [ ] 19. Build verification

---

## Technical Details

### Dependencies
```
Rust:
- tauri-plugin-store = "2"

Frontend:
- @tauri-apps/plugin-store (auto-installed with Tauri)
```

### File Changes Summary
```
Modified:
- src-tauri/Cargo.toml (+store plugin)
- src-tauri/src/lib.rs (+store plugin registration)
- src/components/Terminal.tsx (echo fix, theme support)
- src/components/Sidebar.tsx (theme selector)
- src/contexts/SessionContext.tsx (persistence)
- src/App.tsx (context wiring)

New:
- src/types/theme.ts
- src/contexts/ThemeContext.tsx
- src/contexts/KeyboardContext.tsx
- src/hooks/useShortcut.ts
```

---

## Verification

### Echo Fix
1. Create local session
2. Type `echo test`
3. Should see only one "echo test" output, not two

### Theme Switching
1. Open Settings → Appearance
2. Select different theme
3. Terminal colors should change immediately

### Session Persistence
1. Create SSH session (don't connect, just save config)
2. Close app
3. Reopen app
4. Session should appear in sidebar

### Keyboard Shortcuts
1. Press Ctrl+Shift+N → New session dialog opens
2. Press Ctrl+Tab → Switch to next tab
3. Press Ctrl+W → Close current tab
