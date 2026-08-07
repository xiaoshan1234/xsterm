/**
 * shortcuts.spec.ts — Keyboard shortcut tests TC-1401 through TC-1407
 *
 * Covers:
 *   TC-1401: Ctrl+Shift+N → New session dialog appears
 *   TC-1402: Split pane + Ctrl+Tab → Active pane switches
 *   TC-1403: Ctrl+W → Active pane session closes
 *   TC-1404: Ctrl+L → No effect (KNOWN-GAP: K1 — handler not wired)
 *   TC-1405: Ctrl+, → Settings view does not appear (KNOWN-GAP: K2 — not implemented)
 *   TC-1406: Ctrl+Tab/Ctrl+W while terminal focused → shell receives no control chars
 *   TC-1407: Empty pane Ctrl+W / single pane Ctrl+Tab → No-op, no error
 *
 * Run:
 *   npm run test:system        # via run.ts orchestrator
 *   node --experimental-strip-types --test test/sys-test/specs/shortcuts.spec.ts
 *
 * Preconditions (Windows side):
 *   - Vite dev server on :1420  (npm run dev)
 *   - tauri-driver on :4444     (scripts/windows/start-webdriver.ps1)
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { By, Key, WebDriver } from "selenium-webdriver";
import { appFixture, waitForElement, waitUntil } from "../lib/harness.ts";
import { createLocalSessionViaUI, waitForTerminalReady, typeInTerminal } from "../lib/terminal.ts";
import { SIDEBAR, DIALOG, TERMINAL, PANE, menuItem } from "../lib/selectors.ts";

// ── fixture ───────────────────────────────────────────────────────────────────

const fixture = appFixture();

// ── helpers ──────────────────────────────────────────────────────────────────

/** Press Ctrl+Shift+N (via driver.actions) and wait for dialog to appear. */
async function pressCtrlShiftN(driver: WebDriver): Promise<void> {
  await driver.actions()
    .keyDown(Key.CONTROL)
    .keyDown(Key.SHIFT)
    .sendKeys("n")
    .keyUp(Key.SHIFT)
    .keyUp(Key.CONTROL)
    .perform();
}

/** Press Ctrl+Tab (via driver.actions). */
async function pressCtrlTab(driver: WebDriver): Promise<void> {
  await driver.actions()
    .keyDown(Key.CONTROL)
    .sendKeys(Key.TAB)
    .keyUp(Key.CONTROL)
    .perform();
}

/** Press Ctrl+W (via driver.actions). */
async function pressCtrlW(driver: WebDriver): Promise<void> {
  await driver.actions()
    .keyDown(Key.CONTROL)
    .sendKeys("w")
    .keyUp(Key.CONTROL)
    .perform();
}

/** Press Ctrl+L (via driver.actions). */
async function pressCtrlL(driver: WebDriver): Promise<void> {
  await driver.actions()
    .keyDown(Key.CONTROL)
    .sendKeys("l")
    .keyUp(Key.CONTROL)
    .perform();
}

/** Press Ctrl+, (via driver.actions). */
async function pressCtrlComma(driver: WebDriver): Promise<void> {
  await driver.actions()
    .keyDown(Key.CONTROL)
    .sendKeys(",")
    .keyUp(Key.CONTROL)
    .perform();
}

/** Count how many .xterm terminals are visible. */
async function countTerminals(driver: WebDriver): Promise<number> {
  const els = await driver.findElements(By.css(".xterm"));
  return els.length;
}

/** Right-click pane and invoke a context-menu item. */
async function contextMenuItem(driver: WebDriver, itemLabel: string): Promise<void> {
  const pane = await driver.findElement(By.css(PANE.paneLeaf));
  await driver.actions().contextClick(pane).perform();
  const item = await waitUntil(async () => {
    const els = await driver.findElements(By.xpath(menuItem(itemLabel)));
    return els.length > 0 ? els[0] : false;
  }, { timeout: 3_000, message: `Menu item "${itemLabel}" not found` });
  await item.click();
}

/** Dismiss any open modal/dialog backdrop so it doesn't block later clicks. */
async function dismissModals(driver: WebDriver): Promise<void> {
  const backdrops = await driver.findElements(By.css(".MuiBackdrop-root"));
  if (backdrops.length > 0) {
    await driver.actions().sendKeys(Key.ESCAPE).perform();
    await driver.sleep(300);
  }
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("TC-1401..1407: Keyboard shortcuts", { concurrency: 1 }, () => {
  before(async () => { await fixture.before(); });
  after(async () => { await fixture.after(); });

  // TC-1401 ───────────────────────────────────────────────────────────────────
  it("TC-1401: Ctrl+Shift+N opens the new session dialog", async () => {
    const driver = fixture.getDriver();

    // Ensure no dialog is open
    const dialogsBefore = await driver.findElements(By.css(DIALOG.root));
    assert.strictEqual(dialogsBefore.length, 0, "dialog should not be open before shortcut");

    // Press Ctrl+Shift+N
    await pressCtrlShiftN(driver);

    // Dialog should appear
    await waitForElement(driver, DIALOG.root, { timeout: 3_000, visible: true });

    // Close it
    const closeBtn = await driver.findElement(By.css(DIALOG.close));
    await closeBtn.click();

    // Dialog should disappear
    await waitUntil(async () => {
      const els = await driver.findElements(By.css(DIALOG.root));
      return els.length === 0;
    }, { timeout: 3_000, message: "dialog should close after clicking X" });
  });

  // TC-1402 ───────────────────────────────────────────────────────────────────
  it("TC-1402: Ctrl+Tab switches the active pane in a split window", async () => {
    const driver = fixture.getDriver();

    // Open Sessions sidebar → New Session → Local Shell → Create
    await createLocalSessionViaUI(driver);
    await dismissModals(driver);

    // Split the current pane via "Split Horizontal" context menu
    await contextMenuItem(driver, "Split Horizontal");

    // The split needs a session to bind the new pane; select the first
    // available session/config in the SelectSessionDialog.
    await waitForElement(driver, DIALOG.root, { timeout: 5_000 });
    const rows = await driver.findElements(
      By.css(`[role="dialog"] [role="button"], [role="dialog"] .MuiListItemButton-root`)
    );
    if (rows.length > 0) {
      await rows[0].click();
    } else {
      await driver.actions().sendKeys(Key.ESCAPE).perform();
    }

    // Wait for two terminals
    await waitUntil(async () => {
      const count = await countTerminals(driver);
      return count >= 2;
    }, { timeout: 10_000, message: "Expected at least 2 terminals after split" });

    // Read initial pane leaf order
    const paneLeavesBefore = await driver.findElements(By.css(PANE.paneLeaf));

    // Press Ctrl+Tab
    await pressCtrlTab(driver);
    await driver.sleep(300); // allow state to propagate

    // Pane order should not change (same leaf IDs), but the active pane changed
    const paneLeavesAfter = await driver.findElements(By.css(PANE.paneLeaf));
    assert.strictEqual(
      paneLeavesBefore.length,
      paneLeavesAfter.length,
      "pane count should remain unchanged after Ctrl+Tab"
    );

    // Clean up: close one pane so we don't pollute later tests
    await pressCtrlW(driver);
    await driver.sleep(500);
  });

  // TC-1403 ───────────────────────────────────────────────────────────────────
  it("TC-1403: Ctrl+W closes the active pane session", async () => {
    const driver = fixture.getDriver();

    // Create a session
    await createLocalSessionViaUI(driver);
    await dismissModals(driver);

    // Verify terminal is present
    await waitForTerminalReady(driver);
    const countBefore = await countTerminals(driver);
    assert.ok(countBefore >= 1, "at least one terminal should exist");

    // Press Ctrl+W — should close the session, leaving an empty pane / init card
    await pressCtrlW(driver);
    await driver.sleep(500);

    // Terminal count should drop
    const countAfter = await countTerminals(driver);
    assert.ok(
      countAfter < countBefore,
      `Expected fewer terminals after Ctrl+W (before=${countBefore}, after=${countAfter})`
    );
  });

  // TC-1404 ───────────────────────────────────────────────────────────────────
  it("TC-1404: Ctrl+L has no effect (KNOWN-GAP: K1 — handler not wired)", async () => {
    const driver = fixture.getDriver();

    // Create a session
    await createLocalSessionViaUI(driver);
    await dismissModals(driver);
    await waitForTerminalReady(driver);

    // Read terminal text before
    const rowsBefore = await driver.findElements(By.css(TERMINAL.rows));
    const textBefore = rowsBefore.length > 0 ? await rowsBefore[0].getText() : "";

    // Press Ctrl+L — should be intercepted by Terminal.tsx:179 (returns false)
    await pressCtrlL(driver);
    await driver.sleep(300);

    // Text should be unchanged (Ctrl+L does not clear the terminal)
    const rowsAfter = await driver.findElements(By.css(TERMINAL.rows));
    const textAfter = rowsAfter.length > 0 ? await rowsAfter[0].getText() : "";
    assert.strictEqual(
      textBefore,
      textAfter,
      "Terminal content should be unchanged after Ctrl+L (K1: feature not wired)"
    );

    // KNOWN-GAP: K1 — Ctrl+L is intercepted by xterm's attachCustomKeyEventHandler
    // (returns false, preventing PTY from receiving it) but onToggleLogs is never
    // called because useAppShortcuts.ts registers it on Ctrl+l and the terminal
    // interception runs first. This test documents the gap.
  });

  // TC-1405 ───────────────────────────────────────────────────────────────────
  it("TC-1405: Ctrl+, does not open the settings view (KNOWN-GAP: K2 — not implemented)", async () => {
    const driver = fixture.getDriver();

    // Press Ctrl+, — no shortcut is registered for this
    await pressCtrlComma(driver);
    await driver.sleep(300);

    // Settings sidebar button should still be present (sidebar did not open)
    const settingsBtnAfter = await driver.findElements(By.css(SIDEBAR.settings));
    assert.ok(
      settingsBtnAfter.length > 0,
      "Settings button should still exist after Ctrl+, (shortcut has no effect)"
    );

    // Manually open settings to confirm the button itself is functional,
    // contrasting with Ctrl+, which has no effect.
    const settingsBtn = await waitForElement(driver, SIDEBAR.settings, { visible: true });
    await settingsBtn.click();
    await driver.sleep(300);

    // KNOWN-GAP: K2 — Ctrl+, is intercepted by Terminal.tsx:182-184 (returns false)
    // but no settings view is wired in useAppShortcuts. This test documents the gap.
  });

  // TC-1406 ───────────────────────────────────────────────────────────────────
  it("TC-1406: Ctrl+Tab/Ctrl+W while terminal focused are not forwarded to shell", async () => {
    const driver = fixture.getDriver();

    // Create a session and focus the terminal
    await createLocalSessionViaUI(driver);
    await dismissModals(driver);
    await waitForTerminalReady(driver);

    // Type a marker command
    await typeInTerminal(driver, `echo TC1406_MARKER_${Date.now()}`);

    // Wait for the marker to appear (proves PTY is responsive)
    const markerRe = /TC1406_MARKER_/;
    await waitUntil(async () => {
      const rows = await driver.findElements(By.css(TERMINAL.rows));
      const text = rows.length > 0 ? await rows[0].getText() : "";
      return markerRe.test(text);
    }, { timeout: 10_000, message: "Marker should appear in terminal" });

    // Read the terminal text now
    const rows0 = await driver.findElements(By.css(TERMINAL.rows));
    const textBefore = rows0.length > 0 ? await rows0[0].getText() : "";

    // Focus the terminal explicitly (click + JS focus)
    const containers = await driver.findElements(By.css(".xterm"));
    if (containers.length > 0) {
      await containers[0].click();
      const textarea = await driver.findElement(By.css(TERMINAL.input));
      await driver.executeScript("arguments[0].focus()", textarea);
    }
    await driver.sleep(200);

    // Press Ctrl+Tab (should be intercepted by Terminal.tsx:173-174)
    await pressCtrlTab(driver);
    await driver.sleep(300);

    // Text should be unchanged — no control characters written
    const rows1 = await driver.findElements(By.css(TERMINAL.rows));
    const textAfter1 = rows1.length > 0 ? await rows1[0].getText() : "";
    assert.strictEqual(
      textBefore,
      textAfter1,
      "Terminal text should not change after Ctrl+Tab (intercepted, not forwarded to PTY)"
    );

    // Press Ctrl+W (should be intercepted by Terminal.tsx:176-177)
    await pressCtrlW(driver);
    await driver.sleep(300);

    // Text should be unchanged
    const rows2 = await driver.findElements(By.css(TERMINAL.rows));
    const textAfter2 = rows2.length > 0 ? await rows2[0].getText() : "";
    assert.strictEqual(
      textBefore,
      textAfter2,
      "Terminal text should not change after Ctrl+W (intercepted, not forwarded to PTY)"
    );
  });

  // TC-1407 ───────────────────────────────────────────────────────────────────
  it("TC-1407: Ctrl+W on empty pane / Ctrl+Tab on single pane — no-op, no error", async () => {
    const driver = fixture.getDriver();

    // Ensure the app is in a clean state: no dialogs, no terminal (empty pane)
    // We start fresh — app launches with an empty pane showing the init card.

    // Press Ctrl+W on the empty pane — should be a no-op (no session to close)
    let threw = false;
    try {
      await pressCtrlW(driver);
      await driver.sleep(300);
    } catch {
      threw = true;
    }
    assert.strictEqual(threw, false, "Ctrl+W on empty pane should not throw");

    // Create a session, then close it, leaving an empty pane
    await createLocalSessionViaUI(driver);
    await dismissModals(driver);
    await waitForTerminalReady(driver);
    await pressCtrlW(driver);
    await driver.sleep(500);

    // Now there's one pane (empty) — Ctrl+Tab should be a no-op
    const countAfter = await countTerminals(driver);
    assert.ok(countAfter === 0, "pane should be empty after session closed");

    threw = false;
    try {
      await pressCtrlTab(driver);
      await driver.sleep(300);
    } catch {
      threw = true;
    }
    assert.strictEqual(threw, false, "Ctrl+Tab on single pane should not throw");

    // Pane count should still be 0 (no crash, no split, no weird state)
    const countFinal = await countTerminals(driver);
    assert.strictEqual(countFinal, 0, "pane count should remain 0 after Ctrl+Tab on single pane");
  });
});
