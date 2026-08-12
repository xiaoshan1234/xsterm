/**
 * test/sys-test/specs/window-manager.spec.ts
 *
 * TC-501~505 — Window manager panel (saved window configs).
 * Runs against the real Windows app via tauri-driver (appFixture).
 *
 * Guardrails:
 *  - TC-504 delete has no confirmation dialog (KNOWN-GAP: K4).
 *  - Cleans up created window configs via UI in after().
 */

import { describe, before, after } from "node:test";
import assert from "node:assert";
import { By, Key, WebDriver, WebElement } from "selenium-webdriver";
import { appFixture, tc, waitForElement, waitUntil } from "../lib/harness.ts";
import { SIDEBAR, DIALOG, TAB, TERMINAL, menuItem } from "../lib/selectors.ts";
import { createLocalSessionViaUI } from "../lib/terminal.ts";

const fixture = appFixture();

/** Unique prefix for test-created data. */
const P = `st-win-${Date.now()}`;

// ── helpers ───────────────────────────────────────────────────────────────────

async function openWindowsPanel(driver: WebDriver): Promise<void> {
  const btn = await driver.findElement(By.css(SIDEBAR.windows));
  await btn.click();
  await waitForElement(driver, ".MuiDrawer-paper", { timeout: 5_000 });
}

async function collapseSidebar(driver: WebDriver): Promise<void> {
  const drawer = await driver.findElements(By.css(".MuiDrawer-paper"));
  if (drawer.length === 0) return;
  const btn = await driver.findElement(By.css(SIDEBAR.windows));
  await btn.click();
  await waitUntil(async () => {
    const els = await driver.findElements(By.css(".MuiDrawer-paper"));
    return els.length === 0 ? true : false;
  }, { timeout: 3_000, message: "Sidebar did not collapse" }).catch(() => {});
}

async function findItemByName(driver: WebDriver, name: string): Promise<WebElement> {
  return waitUntil(async () => {
    const els = await driver.findElements(
      By.xpath(
        `//*[contains(@class,'MuiDrawer')]` +
          `//*[contains(@class,'window-manager')]` +
          `//*[normalize-space()="${name}"]`
      )
    );
    if (els.length === 0) return false;
    return (await els[0].isDisplayed()) ? els[0] : false;
  }, { timeout: 5_000, message: `Window "${name}" not found` });
}

async function findActionButton(
  driver: WebDriver,
  name: string,
  ariaLabel: string
): Promise<WebElement> {
  return waitUntil(async () => {
    const els = await driver.findElements(
      By.xpath(
        `//*[contains(@class,'MuiDrawer')]` +
          `//*[contains(@class,'window-manager')]` +
          `//*[normalize-space()="${name}"]` +
          `/ancestor::*[contains(@class,'MuiListItem')]` +
          `//*[@aria-label="${ariaLabel}"]`
      )
    );
    return els.length > 0 ? els[0] : false;
  }, { timeout: 5_000, message: `Button ${ariaLabel} for "${name}" not found` });
}

/** Save the current window as a window config via tab right-click menu. */
async function saveWindowConfig(driver: WebDriver, name: string): Promise<void> {
  const tab = await driver.findElement(By.css(TAB.root));
  await driver.actions().contextClick(tab).perform();
  const save = await waitUntil(async () => {
    const els = await driver.findElements(By.xpath(menuItem("Save as Window Config")));
    return els.length > 0 ? els[0] : false;
  }, { timeout: 5_000, message: "Save as Window Config not found" });
  await save.click();
  const input = await waitForElement(driver, `[role="dialog"] input`, { timeout: 5_000 });
  await input.sendKeys(name);
  const ok = await driver.findElement(
    By.xpath(`//*[@role="dialog"]//button[contains(normalize-space(.),"Save")]`)
  );
  await ok.click();
  await waitUntil(async () => {
    const els = await driver.findElements(By.css(DIALOG.root));
    return els.length === 0 ? true : false;
  }, { timeout: 5_000, message: "Save dialog did not close" });
}

// ── spec ─────────────────────────────────────────────────────────────────────

describe("Window manager (TC-501~505)", { concurrency: false }, () => {
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

  tc("501", "保存窗口配置后双击加载重建会话", async (driver) => {
    // 1. Create a local session so the window has a terminal pane.
    await createLocalSessionViaUI(driver);
    // 2. Save the window as a config.
    const winName = `${P}-win`;
    await saveWindowConfig(driver, winName);
    // 3. Open Windows panel and double-click to load.
    await openWindowsPanel(driver);
    const item = await findItemByName(driver, winName);
    await driver.actions().doubleClick(item).perform();
    // 4. A new tab should appear with a terminal.
    await waitForElement(driver, TERMINAL.rows, { timeout: 15_000 });
    await collapseSidebar(driver);
  });

  tc("502", "右键已保存窗口菜单含 Load/Rename/Delete", async (driver) => {
    const winName = `${P}-win`;
    await openWindowsPanel(driver);
    const item = await findItemByName(driver, winName);
    await driver.actions().contextClick(item).perform();
    for (const label of ["Load", "Rename", "Delete"]) {
      await waitUntil(async () => {
        const els = await driver.findElements(By.xpath(menuItem(label)));
        return els.length > 0 ? true : false;
      }, { timeout: 3_000, message: `Menu item "${label}" not found` });
    }
    await driver.actions().sendKeys(Key.ESCAPE).perform();
    await collapseSidebar(driver);
  });

  tc("503", "重命名窗口配置生效", async (driver) => {
    const winName = `${P}-win`;
    await openWindowsPanel(driver);
    const renameBtn = await findActionButton(driver, winName, "rename");
    await renameBtn.click();
    const input = await waitForElement(driver, `[role="dialog"] input`, { timeout: 5_000 });
    const value = await input.getAttribute("value");
    assert.strictEqual(value, winName, "重命名弹窗应预填当前名称");
    const newName = `${winName}-done`;
    await input.clear();
    await input.sendKeys(newName);
    await driver.findElement(
      By.xpath(`//*[@role="dialog"]//button[contains(normalize-space(.),"Save")]`)
    ).click();
    await waitUntil(async () => {
      const els = await driver.findElements(
        By.xpath(
          `//*[contains(@class,'MuiDrawer')]` +
            `//*[contains(@class,'window-manager')]` +
            `//*[normalize-space()="${newName}"]`
        )
      );
      return els.length > 0 ? true : false;
    }, { timeout: 5_000, message: `重命名后 "${newName}" 未出现` });
    await collapseSidebar(driver);
  });

  tc("504", "删除窗口配置无确认立即删除 (KNOWN-GAP: K4)", async (driver) => {
    const winName = `${P}-win-done`;
    await openWindowsPanel(driver);
    const deleteBtn = await findActionButton(driver, winName, "delete");
    await deleteBtn.click();
    await new Promise((r) => setTimeout(r, 500));
    const dialogs = await driver.findElements(By.css(DIALOG.root));
    assert.strictEqual(dialogs.length, 0, "删除不应弹出确认对话框 (KNOWN-GAP: K4)");
    await waitUntil(async () => {
      const els = await driver.findElements(
        By.xpath(
          `//*[contains(@class,'MuiDrawer')]` +
            `//*[contains(@class,'window-manager')]` +
            `//*[normalize-space()="${winName}"]`
        )
      );
      return els.length === 0 ? true : false;
    }, { timeout: 5_000, message: `删除后 "${winName}" 仍存在` });
    await collapseSidebar(driver);
  });

  tc("505", "空列表显示 No saved windows", async (driver) => {
    await openWindowsPanel(driver);
    // Delete any remaining saved windows with our prefix.
    let more = true;
    while (more) {
      const deletes = await driver.findElements(
        By.css('.window-manager [aria-label="delete"]')
      );
      if (deletes.length === 0) break;
      await deletes[0].click();
      await new Promise((r) => setTimeout(r, 300));
    }
    await waitUntil(async () => {
      const els = await driver.findElements(
        By.xpath(
          `//*[contains(@class,'MuiDrawer')]` +
            `//*[contains(normalize-space(),"No saved windows")]`
        )
      );
      if (els.length === 0) return false;
      return (await els[0].isDisplayed()) ? els[0] : false;
    }, { timeout: 5_000, message: "空列表未显示 No saved windows" });
    await collapseSidebar(driver);
  });
});