/**
 * lib/terminal.ts — xsterm terminal interaction helpers
 *
 * Provides high-level terminal operations for UI tests:
 *   - typeInTerminal          — type text + ENTER into the active terminal
 *   - readTerminalText        — read all visible rows from a terminal
 *   - assertTerminalContains  — poll-assert that terminal text contains a substring
 *   - assertTerminalLineMatches — poll-assert that a specific line matches a regex
 *   - clearTerminal           — clear the terminal screen via context menu
 *   - createLocalSessionViaUI — full UI flow to create a local shell session
 *   - waitForTerminalReady    — wait for .xterm-rows + textarea + prompt
 *
 * Design rules:
 *   - All polling uses harness.waitUntil (no raw sleep).
 *   - DOM channel only — no executeScript on xterm instance methods.
 *   - Multi-terminal: opts.index selects the Nth .xterm container.
 *
 * Dependencies:
 *   - selenium-webdriver: WebDriver, By, Key
 *   - test/sys-test/lib/harness.ts: waitUntil, waitForElement
 *   - test/sys-test/lib/selectors.ts: TERMINAL, SIDEBAR, DIALOG, PANE, menuItem
 *
 * Key source references:
 *   - Terminal.tsx:281  — container div onMouseDown={onFocus} (focus grab)
 *   - Terminal.tsx:270  — xterm.focus() when isActive becomes true
 *   - Terminal.tsx:188  — onData → writeSession (input forwarding to PTY)
 *   - Terminal.tsx:179  — Ctrl+L intercepted (returns false → PTY never sees it)
 *   - useXterm.ts:80    — xterm.open(container) mounts .xterm DOM tree
 *   - probe.spec.ts:246 — validated focus-textarea-via-JS + sendKeys pattern
 */

import { By, Key, WebDriver } from "selenium-webdriver";
import { waitUntil, waitForElement } from "./harness.ts";
import { TERMINAL, SIDEBAR, DIALOG, PANE, menuItem } from "./selectors.ts";

// ── defaults ──────────────────────────────────────────────────────────────────

/** Default polling timeout for assertions (ms). */
const DEFAULT_TIMEOUT = 5_000;

/** Default polling interval for assertions (ms). */
const DEFAULT_INTERVAL = 200;

/** Timeout for terminal readiness after session creation (ms). */
const TERMINAL_READY_TIMEOUT = 15_000;

// ── typeInTerminal ────────────────────────────────────────────────────────────

/**
 * Types text into the active terminal and optionally presses ENTER.
 *
 * Flow:
 *   1. Click the .xterm area to grab focus (Terminal.tsx:281 onMouseDown={onFocus}
 *      → parent sets pane active → Terminal.tsx:270 xterm.focus()). This prevents
 *      focus being grabbed by another pane or UI element (E6 focus-grab protection).
 *   2. Focus the hidden .xterm-helper-textarea via DOM (executeScript focus —
 *      DOM channel, NOT xterm instance manipulation). The textarea is xterm's
 *      keyboard input proxy (opacity:0, offscreen); it can't be clicked directly.
 *   3. sendKeys text + ENTER. xterm captures keydown on the textarea and forwards
 *      to the PTY via onData → writeSession (Terminal.tsx:188-205).
 *
 * Fallback: if sendKeys throws ElementNotInteractable, use the actions API
 * to send keys to the focused element (probe.spec.ts:252-256 pattern).
 *
 * @param driver  WebDriver instance
 * @param text    Text to type (without trailing newline)
 * @param opts.enter  If true (default), append ENTER key after text
 */
export async function typeInTerminal(
  driver: WebDriver,
  text: string,
  opts?: { enter?: boolean }
): Promise<void> {
  const enter = opts?.enter ?? true;

  // 1. Click terminal area to grab focus (Terminal.tsx:281 onMouseDown={onFocus}).
  const containers = await driver.findElements(By.css(".xterm"));
  if (containers.length === 0) {
    throw new Error("typeInTerminal: no terminal (.xterm) found on the page");
  }
  await containers[0].click();

  // 2. Focus the hidden textarea (xterm input proxy).
  //    DOM channel: focusing a DOM element, not calling xterm instance methods.
  //    Same pattern validated in spike/probe.spec.ts:246.
  const textarea = await driver.findElement(By.css(TERMINAL.input));
  await driver.executeScript("arguments[0].focus()", textarea);

  // 3. Send keys. Fallback to actions API if textarea is not interactable.
  try {
    if (enter) {
      await textarea.sendKeys(text, Key.ENTER);
    } else {
      await textarea.sendKeys(text);
    }
  } catch {
    // Fallback: actions API sends keys to the currently focused element
    // (the textarea we just focused via JS).
    if (enter) {
      await driver.actions().sendKeys(text, Key.ENTER).perform();
    } else {
      await driver.actions().sendKeys(text).perform();
    }
  }
}

// ── readTerminalText ──────────────────────────────────────────────────────────

/**
 * Reads all visible text from a terminal's .xterm-rows element.
 *
 * getText() on .xterm-rows returns the full visible terminal content with
 * newlines preserved (each row is a <div> child, getText() joins with \n).
 *
 * @param driver      WebDriver instance
 * @param opts.index  Zero-based terminal index (default 0 = first terminal).
 *                    In multi-terminal scenarios, use this to select which
 *                    .xterm-rows element to read from.
 * @returns The terminal text, or "" if no terminal is present.
 */
export async function readTerminalText(
  driver: WebDriver,
  opts?: { index?: number }
): Promise<string> {
  const index = opts?.index ?? 0;
  const rows = await driver.findElements(By.css(TERMINAL.rows));
  if (rows.length === 0) return "";
  const target = rows[Math.min(index, rows.length - 1)];
  return target.getText();
}

// ── assertTerminalContains ───────────────────────────────────────────────────

/**
 * Polls until the terminal text contains `substr`, or times out.
 *
 * On timeout, throws an Error whose message includes the last terminal text
 * snapshot (first 500 chars) for debugging.
 *
 * @param driver      WebDriver instance
 * @param substr      Substring to search for
 * @param opts.timeout  Max wait time in ms (default 5000)
 * @param opts.interval  Polling interval in ms (default 200)
 * @param opts.index   Terminal index (default 0)
 */
export async function assertTerminalContains(
  driver: WebDriver,
  substr: string,
  opts?: { timeout?: number; interval?: number; index?: number }
): Promise<void> {
  const timeout = opts?.timeout ?? DEFAULT_TIMEOUT;
  const interval = opts?.interval ?? DEFAULT_INTERVAL;
  const index = opts?.index ?? 0;
  let lastText = "";

  try {
    await waitUntil(async () => {
      lastText = await readTerminalText(driver, { index });
      return lastText.includes(substr);
    }, { timeout, interval, message: "__TIMEOUT__" });
  } catch (e) {
    // Only reformat on our own timeout sentinel; rethrow unexpected errors.
    if (e instanceof Error && e.message === "__TIMEOUT__") {
      throw new Error(
        `Terminal does not contain "${substr}" within ${timeout}ms.\n` +
        `Last terminal text (first 500 chars):\n${lastText.slice(0, 500) || "(empty)"}`
      );
    }
    throw e;
  }
}

// ── assertTerminalLineMatches ────────────────────────────────────────────────

/**
 * Polls until terminal line `lineNum` matches `regex`, or times out.
 *
 * Lines are 0-indexed (line 0 is the first row). On timeout, throws an Error
 * whose message includes the line content and full terminal text snapshot.
 *
 * @param driver    WebDriver instance
 * @param lineNum   Zero-based line number
 * @param regex     RegExp to test against the line text
 * @param opts.timeout  Max wait time in ms (default 5000)
 * @param opts.interval  Polling interval in ms (default 200)
 */
export async function assertTerminalLineMatches(
  driver: WebDriver,
  lineNum: number,
  regex: RegExp,
  opts?: { timeout?: number; interval?: number }
): Promise<void> {
  const timeout = opts?.timeout ?? DEFAULT_TIMEOUT;
  const interval = opts?.interval ?? DEFAULT_INTERVAL;
  let lastText = "";

  try {
    await waitUntil(async () => {
      lastText = await readTerminalText(driver, {});
      const lines = lastText.split("\n");
      const line = lines[lineNum];
      if (line === undefined) return false;
      return regex.test(line);
    }, { timeout, interval, message: "__TIMEOUT__" });
  } catch (e) {
    if (e instanceof Error && e.message === "__TIMEOUT__") {
      const lines = lastText.split("\n");
      const line = lines[lineNum];
      throw new Error(
        `Line ${lineNum} does not match ${regex} within ${timeout}ms.\n` +
        `Line ${lineNum} was: "${line ?? "(missing)"}"\n` +
        `Full terminal text (first 500 chars):\n${lastText.slice(0, 500) || "(empty)"}`
      );
    }
    throw e;
  }
}

// ── clearTerminal ─────────────────────────────────────────────────────────────

/**
 * Clears the terminal screen via the pane context menu "Clear Pane" action.
 *
 * Approach: right-click the .pane-leaf element (Pane.tsx:229) to open the
 * context menu, then click the "Clear Pane" menu item (Pane.tsx:208).
 *
 * Ctrl+L is NOT used because Terminal.tsx:179-181 intercepts it in
 * attachCustomKeyEventHandler (returns false), which suppresses xterm's
 * default key processing — the PTY never receives the clear signal.
 *
 * @param driver  WebDriver instance
 */
export async function clearTerminal(driver: WebDriver): Promise<void> {
  // 1. Right-click the pane to open the context menu.
  const pane = await driver.findElement(By.css(PANE.paneLeaf));
  await driver.actions().contextClick(pane).perform();

  // 2. Wait for "Clear Pane" menu item and click it.
  const clearItem = await waitUntil(async () => {
    const els = await driver.findElements(By.xpath(menuItem("Clear Pane")));
    return els.length > 0 ? els[0] : false;
  }, {
    timeout: 3_000,
    interval: DEFAULT_INTERVAL,
    message: "Clear Pane menu item not found within 3s",
  });
  await clearItem.click();
}

// ── createLocalSessionViaUI ───────────────────────────────────────────────────

/**
 * Creates a local shell session through the UI flow:
 *   Sessions sidebar → New Session → Local Shell tab → Create → wait for terminal
 *
 * Flow validated in spike/probe.spec.ts (A1/A3b tests):
 *   1. Click SIDEBAR.sessions (SidebarToolbar "Sessions" button)
 *   2. Click "New Session" (SessionManager footer button)
 *   3. Wait for CreateSessionDialog (MUI Dialog → role="dialog")
 *   4. Click "Local Shell" tab (default-selected, but explicit for reliability)
 *   5. Optionally select a shell from the Shell dropdown
 *   6. Click "Create" (scoped to dialog)
 *   7. Wait for terminal readiness (waitForTerminalReady)
 *
 * @param driver    WebDriver instance
 * @param opts.name  Optional session name (returned as-is for reference; the
 *                  app auto-generates the actual name if no name field exists)
 * @param opts.shell  Optional shell binary (e.g. "powershell.exe", "cmd.exe").
 *                   If provided, selects it from the Shell dropdown.
 * @returns The session name (opts.name or a generated default)
 */
export async function createLocalSessionViaUI(
  driver: WebDriver,
  opts?: { name?: string; shell?: string }
): Promise<string> {
  const name = opts?.name ?? `session-${Date.now()}`;

  // 1. Open the Sessions sidebar panel.
  const sessionsBtn = await waitForElement(driver, SIDEBAR.sessions, {
    timeout: DEFAULT_TIMEOUT,
  });
  await sessionsBtn.click();

  // 2. Click "New Session" button (SessionManager footer).
  //    Scoped to the sidebar (.MuiDrawer-paper) to avoid matching MUI Tab
  //    buttons in the tab bar — MUI Tab renders as <button role="tab">, so
  //    an unscoped //button[contains(., "New Session")] would also match
  //    a window tab named "New Session", and clicking the wrong button
  //    can crash the React tree.
  const sidebar = await waitForElement(driver, ".MuiDrawer-paper", {
    timeout: DEFAULT_TIMEOUT,
  });
  const newSessionBtn = await waitUntil(async () => {
    const els = await sidebar.findElements(
      By.xpath('.//button[contains(., "New Session")]')
    );
    return els.length > 0 ? els[0] : false;
  }, {
    timeout: DEFAULT_TIMEOUT,
    interval: DEFAULT_INTERVAL,
    message: "New Session button not found in sidebar",
  });
  await newSessionBtn.click();

  // 3. Wait for the CreateSessionDialog (MUI Dialog → role="dialog").
  await waitForElement(driver, DIALOG.root, { timeout: DEFAULT_TIMEOUT });

  // 4. Click the "Local Shell" tab (default-selected, but click to be explicit).
  const localTab = await driver.findElement(
    By.xpath('//*[@role="tab" and contains(., "Local Shell")]')
  );
  await localTab.click();

  // 5. Optionally select a shell from the Shell dropdown.
  //    LocalSessionForm.tsx:62 — Select with labelId="shell-select-label".
  //    MUI Select: click combobox to open dropdown, then click the option.
  if (opts?.shell) {
    const shellSelect = await driver.findElement(
      By.css('[aria-labelledby="shell-select-label"]')
    );
    await shellSelect.click();
    const shellOption = await waitUntil(async () => {
      const els = await driver.findElements(
        By.css(`[role="option"][data-value="${opts!.shell}"]`)
      );
      return els.length > 0 ? els[0] : false;
    }, {
      timeout: 3_000,
      interval: DEFAULT_INTERVAL,
      message: `Shell option "${opts.shell}" not found in dropdown`,
    });
    await shellOption.click();
  }

  // 6. Click "Create" (scoped to the dialog to avoid stray matches).
  const createBtn = await driver.findElement(
    By.xpath('//*[@role="dialog"]//button[contains(., "Create")]')
  );
  await createBtn.click();

  // 7. Wait for the terminal to be ready.
  await waitForTerminalReady(driver, { timeout: TERMINAL_READY_TIMEOUT });

  return name;
}

// ── waitForTerminalReady ──────────────────────────────────────────────────────

/**
 * Waits for the terminal to be fully ready for interaction.
 *
 * Readiness criteria:
 *   1. .xterm-rows element exists (xterm mounted and rendered)
 *   2. .xterm-helper-textarea element exists (input channel ready)
 *   3. .xterm-rows has non-empty content (shell prompt rendered — proves
 *      PTY round-trip: backend spawned → output → xterm DOM render)
 *
 * @param driver      WebDriver instance
 * @param opts.timeout  Max wait time in ms (default 15000)
 */
export async function waitForTerminalReady(
  driver: WebDriver,
  opts?: { timeout?: number }
): Promise<void> {
  const timeout = opts?.timeout ?? TERMINAL_READY_TIMEOUT;

  // 1. Wait for .xterm-rows to appear (xterm mounted).
  await waitForElement(driver, TERMINAL.rows, { timeout });

  // 2. Wait for .xterm-helper-textarea to appear (input channel ready).
  await waitForElement(driver, TERMINAL.input, { timeout });

  // 3. Wait for non-empty content (shell prompt rendered — PTY round-trip).
  await waitUntil(async () => {
    const rows = await driver.findElements(By.css(TERMINAL.rows));
    if (rows.length === 0) return false;
    const text = await rows[0].getText();
    return text.trim().length > 0 ? true : false;
  }, {
    timeout,
    interval: DEFAULT_INTERVAL,
    message: `Terminal content empty (no prompt rendered) within ${timeout}ms`,
  });
}
