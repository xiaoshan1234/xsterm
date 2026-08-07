/**
 * Quick diagnostic: inspect DOM state at each step of createLocalSessionViaUI.
 * Run: node --experimental-strip-types test/sys-test/spike/diag.ts
 */
import { By, WebDriver } from "selenium-webdriver";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createDriver } from "../../remote/driver.ts";
import { waitForElement, waitUntil } from "../lib/harness.ts";
import { SIDEBAR, DIALOG } from "../lib/selectors.ts";

const OUT = path.join(import.meta.dirname, "diag-out");

async function shot(driver: WebDriver, name: string): Promise<void> {
  const png = await driver.takeScreenshot();
  await mkdir(OUT, { recursive: true });
  await writeFile(path.join(OUT, `${name}.png`), Buffer.from(png, "base64"));
}

async function dumpAria(driver: WebDriver, label: string): Promise<void> {
  const labels = (await driver.executeScript(
    "return Array.from(document.querySelectorAll('[aria-label]'))" +
      ".map(e => ({tag: e.tagName.toLowerCase(), label: e.getAttribute('aria-label'), cls: e.className.slice(0,60)}));"
  )) as { tag: string; label: string | null; cls: string }[];
  console.log(`[diag:${label}] aria-labels (${labels.length}):`);
  for (const l of labels) console.log(`  ${l.tag}[aria-label="${l.label}"] cls="${l.cls}"`);
}

async function main(): Promise<void> {
  console.log("[diag] creating session...");
  const driver = await createDriver();
  console.log("[diag] waiting for app ready...");
  await waitForElement(driver, '[aria-label="Minimize"]', { timeout: 30_000, visible: true });
  console.log("[diag] app ready");

  await shot(driver, "01-app-ready");
  await dumpAria(driver, "app-ready");

  // Step 1: find Sessions button
  console.log("\n[diag] Step 1: find Sessions button");
  const sessionsBtns = await driver.findElements(By.css(SIDEBAR.sessions));
  console.log(`  Sessions button count: ${sessionsBtns.length}`);
  if (sessionsBtns.length === 0) {
    console.log("  ERROR: Sessions button not found!");
    await shot(driver, "02-no-sessions-btn");
    await driver.quit().catch(() => {});
    return;
  }

  // Step 2: click Sessions button
  console.log("[diag] Step 2: click Sessions button");
  await sessionsBtns[0].click();
  // Small wait for panel to open
  await new Promise(r => setTimeout(r, 500));
  await shot(driver, "03-after-sessions-click");

  // Step 3: find New Session button
  console.log("[diag] Step 3: find New Session button");
  const newSessionBtns = await driver.findElements(By.xpath('//button[contains(., "New Session")]'));
  console.log(`  New Session button count: ${newSessionBtns.length}`);
  if (newSessionBtns.length === 0) {
    console.log("  ERROR: New Session button not found!");
    await shot(driver, "04-no-new-session-btn");
    await dumpAria(driver, "no-new-session");
    await driver.quit().catch(() => {});
    return;
  }

  // Step 4: click New Session
  console.log("[diag] Step 4: click New Session button");
  await newSessionBtns[0].click();
  await new Promise(r => setTimeout(r, 500));
  await shot(driver, "05-after-new-session-click");

  // Step 5: check for dialog
  console.log("[diag] Step 5: check for dialog");
  const dialogs = await driver.findElements(By.css(DIALOG.root));
  console.log(`  Dialog count: ${dialogs.length}`);
  if (dialogs.length === 0) {
    console.log("  ERROR: Dialog not found!");
    await shot(driver, "06-no-dialog");
    await dumpAria(driver, "no-dialog");
    // Also dump all role attributes
    const roles = (await driver.executeScript(
      "return Array.from(document.querySelectorAll('[role]'))" +
        ".map(e => ({tag: e.tagName.toLowerCase(), role: e.getAttribute('role')}));"
    )) as { tag: string; role: string }[];
    console.log(`  Elements with role (${roles.length}):`);
    for (const r of roles.slice(0, 20)) console.log(`    ${r.tag}[role="${r.role}"]`);
  } else {
    console.log("  Dialog found!");
    await shot(driver, "06-dialog-found");
  }

  await driver.quit().catch(() => {});
  console.log("[diag] done");
}

main().catch(console.error);
