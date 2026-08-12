/**
 * xsterm UI Test Selectors
 *
 * All selectors are derived from actual source component attributes.
 * No MUI-generated .css-xxxx classes are used; stable attributes are
 * aria-label, role, title, Tooltip title, or text content.
 *
 * Note: SidebarToolbar buttons lack aria-label — Tooltip title is used
 * as a fragile fallback. If Tooltip props change these selectors break.
 */

/** Navigation bar — window controls (src/components/NavBar.tsx) */
export const NAV = {
  /** src/components/NavBar.tsx:75 — Minimize button */
  minimize: '[aria-label="Minimize"]',
  /** src/components/NavBar.tsx:83 — Maximize OR Restore (state-dependent, use both) */
  maximizeRestore: '[aria-label="Maximize"], [aria-label="Restore"]',
  /** src/components/NavBar.tsx:95 — scoped to header to avoid conflict with Dialog close */
  close: 'header [aria-label="Close"]',
  /** src/components/NavBar.tsx:68 — app logo image */
  logo: 'header img[alt="xsterm"]',
} as const;

/**
 * Sidebar toolbar — five icon buttons (src/components/sidebar/SidebarToolbar.tsx).
 * These IconButtons have NO aria-label; each is wrapped by a Tooltip with
 * a title prop. MUI renders Tooltip as a span with role="tooltip" and
 * propagates the title as an aria-label on that wrapper.
 *
 * FRAGILE: if Tooltip wrapping is removed or the aria-label propagation
 * behaviour changes, these selectors break. Prefer adding aria-label to
 * each IconButton in source to stabilise these.
 */
export const SIDEBAR = {
  /** src/components/sidebar/SidebarToolbar.tsx:30 — Tooltip title="Sessions" (aria-label from MUI Tooltip) */
  sessions: '[aria-label="Sessions"]',
  /** src/components/sidebar/SidebarToolbar.tsx:39 — Tooltip title="Workspaces" */
  workspaces: '[aria-label="Workspaces"]',
  /** src/components/sidebar/SidebarToolbar.tsx:48 — Tooltip title="Windows" */
  windows: '[aria-label="Windows"]',
  /** src/components/sidebar/SidebarToolbar.tsx:57 — Tooltip title="Logs" */
  logs: '[aria-label="Logs"]',
  /** src/components/sidebar/SidebarToolbar.tsx:64 — Tooltip title="Settings" */
  settings: '[aria-label="Settings"]',
} as const;

/** Dialog — MUI Dialog close button (Dialog.tsx) */
export const DIALOG = {
  /** Dialog.tsx:25 — dialog root element (MUI renders role="dialog" implicitly) */
  root: '[role="dialog"]',
  /** Dialog.tsx:34 — close X button; scoped to dialog root to avoid NavBar conflict */
  close: '[role="dialog"] [aria-label="Close"]',
} as const;

/** Tab bar & window controls (WorkspaceContainer.tsx → WindowTabBar) */
export const TAB = {
  /** TabBar.tsx:45 — MUI Tabs renders role="tablist", child Tab renders role="tab" */
  root: '[role="tab"]',
  /** WorkspaceContainer.tsx:252 — add new window button */
  newWindow: '[title="New window"]',
  /** WorkspaceContainer.tsx:255 — save all windows as workspace button */
  saveWorkspace: '[title="Save all windows as workspace"]',
} as const;

/** Terminal (xterm.js) — Terminal.tsx mounts container div → xterm library adds .xterm-* */
export const TERMINAL = {
  /**
   * xterm.js terminal content container.
   * xterm.js adds class "xterm-rows" to its screen div — not defined in our source,
   * comes from the xterm library. Source: Terminal.tsx:278 (containerRef).
   */
  rows: '.xterm-rows',
  /**
   * xterm.js hidden textarea for IME / keyboard input capture.
   * xterm.js adds class "xterm-helper-textarea" — not defined in our source.
   * Source: Terminal.tsx (xterm.js internals).
   */
  input: '.xterm-helper-textarea',
} as const;

/** Pane — InitWindowView + PaneInitCard (PaneInitCard.tsx) */
export const PANE = {
  /**
   * Pane.tsx:289-305 — error bar shown when session is disconnected.
   * No stable semantic attribute; uses text content "连接已经断开，输入回车重新进行连接".
   * Note: text is Chinese; locator may need i18n-aware update if locale changes.
   */
  disconnectBanner: 'text="连接已经断开，输入回车重新进行连接"',
  /** PaneInitCard.tsx:164 — "Create New" card action area */
  initCardCreate: 'text="Create New"',
  /** PaneInitCard.tsx:186 — "Open Saved" card action area */
  initCardOpen: 'text="Open Saved"',
  /**
   * Pane.tsx:229 — ContextMenu wraps pane content with className="pane-leaf".
   * Stable anchor for locating the pane context wrapper.
   */
  paneLeaf: '.pane-leaf',
} as const;

/**
 * Build an XPath selector for a menu item by its exact text.
 *
 * WebDriver (W3C) does not support CSS `:has-text()` pseudo-class.
 * Use this factory function to produce XPath selectors that match
 * menu items by their visible text content.
 *
 * Usage (Playwright / WebDriver):
 *   page.locator(`xpath=${menuItem("Close Pane")}`).click()
 *
 * @param label  Exact text of the menu item (case-sensitive)
 * @returns XPath selector string
 */
export function menuItem(label: string): string {
  return `//*[role="menu"]//*[role="menuitem"][normalize-space()="${label}"]`;
}
