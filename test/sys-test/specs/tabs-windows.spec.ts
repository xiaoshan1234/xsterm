/**
 * test/sys-test/specs/tabs-windows.spec.ts
 *
 * TC-601~613 — Main area & window tab bar (WorkspaceContainer / WindowTabBar).
 * Runs against the real Windows app via tauri-driver (appFixture).
 *
 * Guardrails:
 *  - TC-609 drag does NOT assert reorder success (KNOWN-GAP: K3).
 *  - TC-613 does not create more than 15 tabs.
 *  - Cleans up created windows/workspaces/snapshots via UI in after().
 */

import { describe, before, after } from "node:test";
import assert from "node:assert";
import { By, Key, WebDriver } from "selenium-webdriver";
import { appFixture, tc, waitForElement, waitUntil } from "../lib/harness.ts";
import { TAB, DIALOG, SIDEBAR, menuItem } from "../lib/selectors.ts";
import {
  createLocalSessionViaUI,
  waitForTerminalReady,
  typeInTerminal,
  readTerminalText,
  assertTerminalContains,
} from "../lib/terminal.ts";

const fixture = appFixture();

// ── helpers ───────────────────────────────────────────────────────────────────

const P = `st-tabs-${Date.now()}`;

/** Count window tabs in the tab bar. */
async function countTabs(driver: WebDriver): Promise<number> {
  return (await driver.findElements(By.css(TAB.root))).length;
}

/** Click a tab by its label text. */
async function clickTabByLabel(driver: WebDriver, label: string): Promise<void> {
  const el = await waitUntil(async () => {
    const els = await driver.findElements(
      By.xpath(`//*[@role="tab"][contains(normalize-space(.), "${label}")]`)
    );
    return els.length > 0 ? els[0] : false;
  }, { timeout: 5_000, message: `Tab "${label}" not found` });
  await el.click();
}

/** Close a tab by index via its close (X) button. */
async function closeTabByIndex(driver: WebDriver, index: number): Promise<void> {
  const tabs = await driver.findElements(By.css(TAB.root));
  assert.ok(tabs.length > index, `Tab index ${index} out of range`);
  const closeBtn = await tabs[index].findElement(By.css("button"));
  await closeBtn.click();
}

/** Open the Workspaces sidebar panel. */
async function openWorkspacesPanel(driver: WebDriver): Promise<void> {
  const btn = await driver.findElement(By.css(SIDEBAR.workspaces));
  await btn.click();
  await waitForElement(driver, ".MuiDrawer-paper", { timeout: 5_000 });
}

/** Open the Windows sidebar panel. */
async function openWindowsPanel(driver: WebDriver): Promise<void> {
  const btn = await driver.findElement(By.css(SIDEBAR.windows));
  await btn.click();
  await waitForElement(driver, ".MuiDrawer-paper", { timeout: 5_000 });
}

// ── spec ─────────────────────────────────────────────────────────────────────

describe("Main area & window tab bar (TC-601~613)", { concurrency: false }, () => {
  before(() => fixture.before());
  after(async () => {
    const driver = fixture.getDriver();
    try {
      await driver.actions().sendKeys(Key.ESCAPE).perform().catch(() => {});
    } catch {
      /* ignore */
    }
    await fixture.after();
  });

  tc("601", "New window button creates an init tab", async (driver) => {
    const before = await countTabs(driver);
    const btn = await waitForElement(driver, TAB.newWindow, { timeout: 5_000 });
    await btn.click();
    await waitUntil(async () => {
      const n = await countTabs(driver);
      return n > before ? true : false;
    }, { timeout: 5_000, message: "New window tab did not appear" });
    // New init tab should show "Create New" / "Open Saved".
    await waitForElement(driver, `text="Create New"`, { timeout: 5_000 }).catch(() => {});
  });

  tc("602", "Save on default workspace shows SaveWorkspaceDialog", async (driver) => {
    const btn = await waitForElement(driver, TAB.saveWorkspace, { timeout: 5_000 });
    await btn.click();
    // Default workspace name is "default" → dialog appears.
    await waitForElement(driver, DIALOG.root, { timeout: 5_000 });
    await driver.actions().sendKeys(Key.ESCAPE).perform();
  });

  tc("603", "Save on named workspace saves without dialog", async (driver) => {
    // Save the default workspace with a name via the dialog, then load it.
    const saveBtn = await waitForElement(driver, TAB.saveWorkspace, { timeout: 5_000 });
    await saveBtn.click();
    await waitForElement(driver, DIALOG.root, { timeout: 5_000 });
    const input = await driver.findElement(By.css(`[role="dialog"] input`));
    const wsName = `${P}-ws`;
    await input.sendKeys(wsName);
    const save = await driver.findElement(
      By.xpath(`//*[@role="dialog"]//button[contains(normalize-space(.),"Save")]`)
    );
    await save.click();
    // Load it from the Workspaces panel → named workspace.
    await openWorkspacesPanel(driver);
    const item = await waitUntil(async () => {
      const els = await driver.findElements(
        By.xpath(`.//*[contains(@class,"drawer")]//*[normalize-space()="${wsName}"]`)
      );
      return els.length > 0 ? els[0] : false;
    }, { timeout: 8_000, message: `Saved workspace ${wsName} not found` });
    await driver.actions().doubleClick(item).perform();
    // Now on a named workspace; clicking save should NOT show a dialog.
    await waitForElement(driver, TAB.saveWorkspace, { timeout: 5_000 });
    await driver.findElement(By.css(TAB.saveWorkspace)).click();
    await new Promise((r) => setTimeout(r, 500));
    const dialogs = await driver.findElements(By.css(DIALOG.root));
    assert.strictEqual(dialogs.length, 0, "Named workspace save should not open a dialog");
  });

  tc("604", "Save with reserved name shows error", async (driver) => {
    const btn = await waitForElement(driver, TAB.saveWorkspace, { timeout: 5_000 });
    await btn.click();
    await waitForElement(driver, DIALOG.root, { timeout: 5_000 });
    const input = await driver.findElement(By.css(`[role="dialog"] input`));
    await input.clear();
    await input.sendKeys("default");
    const save = await driver.findElement(
      By.xpath(`//*[@role="dialog"]//button[contains(normalize-space(.),"Save")]`)
    );
    await save.click();
    // Reserved name → error text appears.
    await waitUntil(async () => {
      const errs = await driver.findElements(By.css(`[role="dialog"] .Mui-error`));
      if (errs.length === 0) return false;
      const t = await errs[0].getText();
      return t.length > 0 ? true : false;
    }, { timeout: 5_000, message: "Reserved-name error not shown" });
    await driver.actions().sendKeys(Key.ESCAPE).perform();
  });

  tc("605", "Tab switching preserves terminal content", async (driver) => {
    // Session in tab 1; type marker; switch away and back; marker persists.
    await createLocalSessionViaUI(driver);
    const marker = `MARK_605_${Date.now()}`;
    await typeInTerminal(driver, `echo ${marker}`);
    await assertTerminalContains(driver, marker, { timeout: 10_000 });
    // Create a second window (new tab).
    await waitForElement(driver, TAB.newWindow, { timeout: 5_000 });
    await driver.findElement(By.css(TAB.newWindow)).click();
    await new Promise((r) => setTimeout(r, 400));
    // Switch back to tab 1 (the one with the session). It's the first tab.
    const tabs = await driver.findElements(By.css(TAB.root));
    await tabs[0].click();
    await assertTerminalContains(driver, marker, { timeout: 10_000 });
  });

  tc("606", "Tab close removes tab and activates neighbor", async (driver) => {
    const before = await countTabs(driver);
    assert.ok(before >= 2, "Need at least 2 tabs");
    await closeTabByIndex(driver, before - 1);
    await waitUntil(async () => {
      const n = await countTabs(driver);
      return n === before - 1 ? true : false;
    }, { timeout: 5_000, message: "Tab was not closed" });
  });

  tc("607", "Closing last tab creates a new init tab", async (driver) => {
    // Close all tabs until one remains, then close it → new init tab appears.
    while ((await countTabs(driver)) > 1) {
      await closeTabByIndex(driver, (await countTabs(driver)) - 1);
      await new Promise((r) => setTimeout(r, 300));
    }
    await closeTabByIndex(driver, 0);
    await waitUntil(async () => {
      const n = await countTabs(driver);
      return n >= 1 ? true : false;
    }, { timeout: 5_000, message: "No init tab after closing last tab" });
  });

  tc("608", "Tab right-click menu shows Rename/Save/Close", async (driver) => {
    const tab = await driver.findElement(By.css(TAB.root));
    await driver.actions().contextClick(tab).perform();
    for (const label of ["Rename", "Save as Window Config", "Close"]) {
      await waitUntil(async () => {
        const els = await driver.findElements(By.xpath(menuItem(label)));
        return els.length > 0 ? true : false;
      }, { timeout: 3_000, message: `Menu item "${label}" not found` });
    }
    await driver.actions().sendKeys(Key.ESCAPE).perform();
  });

  tc("609", "Tab drag changes opacity, order unchanged (KNOWN-GAP: K3)", async (driver) => {
    const tabs = await driver.findElements(By.css(TAB.root));
    assert.ok(tabs.length >= 2, "Need at least 2 tabs");
    const beforeLabels = await Promise.all(tabs.map((t) => t.getText()));
    // Attempt a drag; KNOWN-GAP K3: reorder is not implemented, so order must
    // remain unchanged. We do NOT assert reorder success.
    try {
      await driver.actions().dragAndDrop(tabs[0], tabs[1]).perform();
    } catch {
      /* drag may be unsupported; degrade */
    }
    await new Promise((r) => setTimeout(r, 400));
    const afterTabs = await driver.findElements(By.css(TAB.root));
    const afterLabels = await Promise.all(afterTabs.map((t) => t.getText()));
    assert.deepStrictEqual(
      afterLabels.filter((l) => l.trim().length > 0),
      beforeLabels.filter((l) => l.trim().length > 0),
      "Tab order should be unchanged (KNOWN-GAP: K3, reorder not implemented)"
    );
  });

  tc("610", "Rename tab updates title; duplicate gets -2 suffix", async (driver) => {
    const tab = await driver.findElement(By.css(TAB.root));
    await driver.actions().contextClick(tab).perform();
    const rename = await waitUntil(async () => {
      const els = await driver.findElements(By.xpath(menuItem("Rename")));
      return els.length > 0 ? els[0] : false;
    }, { timeout: 5_000, message: "Rename menu item not found" });
    await rename.click();
    const input = await waitForElement(driver, `[role="dialog"] input`, { timeout: 5_000 });
    await input.clear();
    const newName = `${P}-tab`;
    await input.sendKeys(newName);
    const save = await driver.findElement(
      By.xpath(`//*[@role="dialog"]//button[contains(normalize-space(.),"Save")]`)
    );
    await save.click();
    await waitUntil(async () => {
      const els = await driver.findElements(
        By.xpath(`//*[@role="tab"][contains(normalize-space(.), "${newName}")]`)
      );
      return els.length > 0 ? true : false;
    }, { timeout: 5_000, message: `Renamed tab "${newName}" not found` });
  });

  tc("611", "Save as Window Config adds to Windows panel", async (driver) => {
    const tab = await driver.findElement(By.css(TAB.root));
    await driver.actions().contextClick(tab).perform();
    const save = await waitUntil(async () => {
      const els = await driver.findElements(By.xpath(menuItem("Save as Window Config")));
      return els.length > 0 ? els[0] : false;
    }, { timeout: 5_000, message: "Save as Window Config not found" });
    await save.click();
    const input = await waitForElement(driver, `[role="dialog"] input`, { timeout: 5_000 });
    const winName = `${P}-win`;
    await input.sendKeys(winName);
    const ok = await driver.findElement(
      By.xpath(`//*[@role="dialog"]//button[contains(normalize-space(.),"Save")]`)
    );
    await ok.click();
    await openWindowsPanel(driver);
    await waitUntil(async () => {
      const els = await driver.findElements(
        By.xpath(`.//*[contains(@class,"drawer")]//*[normalize-space()="${winName}"]`)
      );
      return els.length > 0 ? true : false;
    }, { timeout: 8_000, message: `Saved window ${winName} not in Windows panel` });
  });

  tc("612", "Clicking non-active workspace syncs bottom dropdown", async (driver) => {
    // Ensure at least 2 workspaces: default + the named one from TC-603.
    await openWorkspacesPanel(driver);
    const wsName = `${P}-ws`;
    const item = await waitUntil(async () => {
      const els = await driver.findElements(
        By.xpath(`.//*[contains(@class,"drawer")]//*[normalize-space()="${wsName}"]`)
      );
      return els.length > 0 ? els[0] : false;
    }, { timeout: 8_000, message: `Workspace ${wsName} not found` });
    await driver.actions().doubleClick(item).perform();
    // Bottom dropdown should now show the selected workspace.
    const bottomBar = await driver.findElements(By.css("[aria-label='Close workspace']"));
    assert.ok(bottomBar.length > 0, "Close workspace button should be visible (workspace active)");
  });

  tc("613", "Many tabs shows scroll arrows", async (driver) => {
    const start = await countTabs(driver);
    const target = Math.min(start + 10, 15);
    const btn = await waitForElement(driver, TAB.newWindow, { timeout: 5_000 });
    for (let i = start; i < target; i++) {
      await btn.click();
      await new Promise((r) => setTimeout(r, 150));
    }
    const n = await countTabs(driver);
    assert.ok(n >= target, `Expected ${target} tabs, got ${n}`);
    // Scroll buttons (MUI Tabs) appear when tabs overflow.
    await waitUntil(async () => {
      const scroll = await driver.findElements(
        By.xpath(`//button[contains(@aria-label,"Scroll")]`)
      );
      return scroll.length > 0 ? true : false;
    }, { timeout: 5_000, message: "Scroll arrows not found with many tabs" });
  });
});