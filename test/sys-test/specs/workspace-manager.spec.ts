/**
 * test/sys-test/specs/workspace-manager.spec.ts
 *
 * TC-401~410 — Workspace manager panel.
 * Runs against the real Windows app via tauri-driver (appFixture).
 *
 * Guardrails:
 *  - TC-406 delete has no confirmation dialog (KNOWN-GAP: K4).
 *  - TC-410 load-failure rollback is skipped when we cannot construct a real
 *    failure without mocking the backend.
 */

import { describe, before, after, it } from "node:test";
import assert from "node:assert";
import { By, Key, WebDriver, WebElement } from "selenium-webdriver";
import { appFixture, tc, waitForElement, waitUntil } from "../lib/harness.ts";
import { SIDEBAR, DIALOG, TAB, TERMINAL, menuItem } from "../lib/selectors.ts";
import { createLocalSessionViaUI } from "../lib/terminal.ts";

const fixture = appFixture();

/** Unique prefix for test-created data. */
const P = `st-ws-${Date.now()}`;

// ── helpers ───────────────────────────────────────────────────────────────────

async function openWorkspacesPanel(driver: WebDriver): Promise<void> {
  const btn = await driver.findElement(By.css(SIDEBAR.workspaces));
  await btn.click();
  await waitForElement(driver, ".MuiDrawer-paper", { timeout: 5_000 });
}

async function collapseSidebar(driver: WebDriver): Promise<void> {
  const drawer = await driver.findElements(By.css(".MuiDrawer-paper"));
  if (drawer.length === 0) return;
  const btn = await driver.findElement(By.css(SIDEBAR.workspaces));
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
          `//*[contains(@class,'workspace-manager')]` +
          `//*[normalize-space()="${name}"]`
      )
    );
    if (els.length === 0) return false;
    return (await els[0].isDisplayed()) ? els[0] : false;
  }, { timeout: 5_000, message: `Workspace "${name}" not found` });
}

async function findListItemButton(driver: WebDriver, name: string): Promise<WebElement> {
  return waitUntil(async () => {
    const els = await driver.findElements(
      By.xpath(
        `//*[contains(@class,'MuiDrawer')]` +
          `//*[contains(@class,'workspace-manager')]` +
          `//*[contains(@class,'MuiListItemButton')]` +
          `[.//*[normalize-space()="${name}"]]`
      )
    );
    return els.length > 0 ? els[0] : false;
  }, { timeout: 5_000, message: `ListItemButton for "${name}" not found` });
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
          `//*[contains(@class,'workspace-manager')]` +
          `//*[normalize-space()="${name}"]` +
          `/ancestor::*[contains(@class,'MuiListItem')]` +
          `//*[@aria-label="${ariaLabel}"]`
      )
    );
    return els.length > 0 ? els[0] : false;
  }, { timeout: 5_000, message: `Button ${ariaLabel} for "${name}" not found` });
}

async function countSavedItems(driver: WebDriver): Promise<number> {
  const drawer = await driver.findElement(By.css(".MuiDrawer-paper"));
  return (await drawer.findElements(
    By.css('.workspace-manager [aria-label="delete"]')
  )).length;
}

async function saveWorkspaceWithName(driver: WebDriver, name: string): Promise<void> {
  const btn = await waitForElement(driver, TAB.saveWorkspace, { timeout: 5_000 });
  await btn.click();
  await waitForElement(driver, DIALOG.root, { timeout: 5_000 });
  const input = await driver.findElement(By.css(`[role="dialog"] input`));
  await input.clear();
  await input.sendKeys(name);
  const save = await driver.findElement(
    By.xpath(`//*[@role="dialog"]//button[contains(normalize-space(.),"Save")]`)
  );
  await save.click();
  await waitUntil(async () => {
    const els = await driver.findElements(By.css(DIALOG.root));
    return els.length === 0 ? true : false;
  }, { timeout: 5_000, message: "SaveWorkspaceDialog did not close" });
}

async function closeActiveWorkspace(driver: WebDriver): Promise<void> {
  const btn = await driver.findElement(By.css('[aria-label="Close workspace"]'));
  await btn.click();
}

async function isSelected(el: WebElement): Promise<boolean> {
  const cls = await el.getAttribute("class");
  return cls != null && cls.includes("Mui-selected");
}

// ── spec ─────────────────────────────────────────────────────────────────────

describe("Workspace manager (TC-401~410)", { concurrency: false }, () => {
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

  tc("401", "打开 Workspaces 面板 default 项显示", async (driver) => {
    await openWorkspacesPanel(driver);
    const item = await findItemByName(driver, "default");
    assert.ok(await item.isDisplayed(), "default 项应可见");
    await collapseSidebar(driver);
  });

  tc("402", "双击 default 创建/激活工作区", async (driver) => {
    await openWorkspacesPanel(driver);
    const item = await findItemByName(driver, "default");
    await driver.actions().doubleClick(item).perform();
    await waitUntil(async () => {
      const tabs = await driver.findElements(By.css(TAB.root));
      return tabs.length > 0 ? true : false;
    }, { timeout: 5_000, message: "双击 default 后未出现 tab" });
    await collapseSidebar(driver);
  });

  tc("403", "已有 default 再双击数量不变", async (driver) => {
    const before = (await driver.findElements(By.css(TAB.root))).length;
    await openWorkspacesPanel(driver);
    const item = await findItemByName(driver, "default");
    await driver.actions().doubleClick(item).perform();
    await waitUntil(async () => {
      const after = (await driver.findElements(By.css(TAB.root))).length;
      return after === before ? true : false;
    }, { timeout: 5_000, message: "双击 default 后 tab 数量变化" });
    await collapseSidebar(driver);
  });

  tc("404", "保存快照后关闭再双击加载重建会话", async (driver) => {
    // 1. 创建本地会话（终端运行中）
    await createLocalSessionViaUI(driver);
    // 2. 保存工作区快照
    const wsName = `${P}-save`;
    await saveWorkspaceWithName(driver, wsName);
    // 3. 关闭工作区
    await closeActiveWorkspace(driver);
    await new Promise((r) => setTimeout(r, 500));
    // 4. 双击加载
    await openWorkspacesPanel(driver);
    const item = await findItemByName(driver, wsName);
    await driver.actions().doubleClick(item).perform();
    // 5. 验证终端重建
    await waitForElement(driver, TERMINAL.rows, { timeout: 15_000 });
    await collapseSidebar(driver);
  });

  tc("405", "右键快照 Load/Switch 文案随 isLoaded 切换", async (driver) => {
    const wsName = `${P}-save`;
    // 1. 工作区已加载（TC-404）→ 右键应显示 "Switch"
    await openWorkspacesPanel(driver);
    const item = await findItemByName(driver, wsName);
    await driver.actions().contextClick(item).perform();
    await waitUntil(async () => {
      const els = await driver.findElements(By.xpath(menuItem("Switch")));
      return els.length > 0 ? true : false;
    }, { timeout: 3_000, message: "已加载时应显示 Switch" });
    await driver.actions().sendKeys(Key.ESCAPE).perform();
    await collapseSidebar(driver);

    // 2. 关闭工作区 → 右键应显示 "Load"
    await closeActiveWorkspace(driver);
    await new Promise((r) => setTimeout(r, 500));
    await openWorkspacesPanel(driver);
    const item2 = await findItemByName(driver, wsName);
    await driver.actions().contextClick(item2).perform();
    await waitUntil(async () => {
      const els = await driver.findElements(By.xpath(menuItem("Load")));
      return els.length > 0 ? true : false;
    }, { timeout: 3_000, message: "未加载时应显示 Load" });
    await driver.actions().sendKeys(Key.ESCAPE).perform();
    await collapseSidebar(driver);
  });

  tc("406", "删除图标无确认弹窗且列表项消失 (KNOWN-GAP: K4)", async (driver) => {
    const wsName = `${P}-save`;
    await openWorkspacesPanel(driver);
    const deleteBtn = await findActionButton(driver, wsName, "delete");
    await deleteBtn.click();
    await new Promise((r) => setTimeout(r, 500));
    const dialogs = await driver.findElements(By.css(DIALOG.root));
    assert.strictEqual(dialogs.length, 0, "删除不应弹出确认对话框 (KNOWN-GAP: K4)");
    await waitUntil(async () => {
      const els = await driver.findElements(
        By.xpath(
          `//*[contains(@class,'MuiDrawer')]` +
            `//*[contains(@class,'workspace-manager')]` +
            `//*[normalize-space()="${wsName}"]`
        )
      );
      return els.length === 0 ? true : false;
    }, { timeout: 5_000, message: `删除后 "${wsName}" 仍存在` });
    await collapseSidebar(driver);
  });

  tc("407", "重命名弹窗预填聚焦且改名生效空白忽略", async (driver) => {
    const wsName = `${P}-rename`;
    await saveWorkspaceWithName(driver, wsName);
    await openWorkspacesPanel(driver);
    const renameBtn = await findActionButton(driver, wsName, "rename");
    await renameBtn.click();
    const input = await waitForElement(driver, `[role="dialog"] input`, { timeout: 5_000 });
    const value = await input.getAttribute("value");
    assert.strictEqual(value, wsName, "重命名弹窗应预填当前名称");
    const focused = await driver.executeScript(
      "return document.activeElement === arguments[0];",
      input
    );
    assert.ok(focused, "重命名输入框应自动聚焦");
    const newName = `${wsName}-done`;
    await input.clear();
    await input.sendKeys(newName);
    await driver.findElement(
      By.xpath(`//*[@role="dialog"]//button[normalize-space()="Rename"]`)
    ).click();
    await waitUntil(async () => {
      const els = await driver.findElements(
        By.xpath(
          `//*[contains(@class,'MuiDrawer')]` +
            `//*[contains(@class,'workspace-manager')]` +
            `//*[normalize-space()="${newName}"]`
        )
      );
      return els.length > 0 ? true : false;
    }, { timeout: 5_000, message: `重命名后 "${newName}" 未出现` });
    // 空白提交后名称不变
    const renameBtn2 = await findActionButton(driver, newName, "rename");
    await renameBtn2.click();
    const input2 = await waitForElement(driver, `[role="dialog"] input`, { timeout: 5_000 });
    await input2.clear();
    await driver.findElement(
      By.xpath(`//*[@role="dialog"]//button[normalize-space()="Rename"]`)
    ).click();
    await waitUntil(async () => {
      const els = await driver.findElements(
        By.xpath(
          `//*[contains(@class,'MuiDrawer')]` +
            `//*[contains(@class,'workspace-manager')]` +
            `//*[normalize-space()="${newName}"]`
        )
      );
      return els.length > 0 ? true : false;
    }, { timeout: 3_000, message: "空白提交后名称不应改变" });
    await collapseSidebar(driver);
  });

  tc("408", "空列表显示 No saved workspaces", async (driver) => {
    await openWorkspacesPanel(driver);
    let count = await countSavedItems(driver);
    while (count > 0) {
      const deleteBtns = await driver.findElements(
        By.css('.workspace-manager [aria-label="delete"]')
      );
      if (deleteBtns.length === 0) break;
      await deleteBtns[0].click();
      await new Promise((r) => setTimeout(r, 300));
      count = await countSavedItems(driver);
    }
    await waitUntil(async () => {
      const els = await driver.findElements(
        By.xpath(
          `//*[contains(@class,'MuiDrawer')]` +
            `//*[contains(normalize-space(),"No saved workspaces")]`
        )
      );
      if (els.length === 0) return false;
      return (await els[0].isDisplayed()) ? els[0] : false;
    }, { timeout: 5_000, message: "空列表未显示 No saved workspaces" });
    const defaultItem = await findItemByName(driver, "default");
    assert.ok(await defaultItem.isDisplayed(), "default 项应始终可见");
    await collapseSidebar(driver);
  });

  tc("409", "单击选中高亮切换", async (driver) => {
    const wsName = `${P}-select`;
    await saveWorkspaceWithName(driver, wsName);
    await openWorkspacesPanel(driver);
    const savedBtn = await findListItemButton(driver, wsName);
    await savedBtn.click();
    assert.ok(await isSelected(savedBtn), "单击后应高亮选中");
    const defaultBtn = await findListItemButton(driver, "default");
    await defaultBtn.click();
    assert.ok(await isSelected(defaultBtn), "default 应高亮选中");
    assert.ok(!(await isSelected(savedBtn)), "原选中项应取消高亮");
    await collapseSidebar(driver);
  });

  it({
    skip:
      "无法在不修改 src/ 或 src-tauri/ 的前提下构造真实的 loadWorkspace 失败场景。" +
      "loadWorkspace 失败时仅记录日志不回滚 UI，需 mock 后端 IPC 或注入损坏 store 数据，" +
      "均超出 UI 测试范围。",
  }, "TC-410: 加载失败回滚");
});