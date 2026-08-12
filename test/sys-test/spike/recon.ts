/**
 * Recon: confirm the root cause of the dialog crash.
 * Injects a window error listener, clicks Sessions → New Session,
 * then reads the captured errors and checks if #root was unmounted.
 */
import { By, WebDriver } from "selenium-webdriver";
import { createDriver } from "../../remote/driver.ts";
import { waitForElement } from "../lib/harness.ts";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const EVIDENCE = path.join(import.meta.dirname, "..", "..", "..", ".omo", "evidence");

async function shot(driver: WebDriver, name: string): Promise<void> {
  await mkdir(EVIDENCE, { recursive: true });
  const png = await driver.takeScreenshot();
  await writeFile(path.join(EVIDENCE, `recon-${name}.png`), Buffer.from(png, "base64"));
}

async function state(driver: WebDriver, label: string): Promise<void> {
  const url = await driver.getCurrentUrl();
  const rootChildren = await driver.executeScript(
    "return document.getElementById('root') ? document.getElementById('root').childElementCount : -1;"
  );
  const rootHTMLlen = await driver.executeScript(
    "return document.getElementById('root') ? document.getElementById('root').innerHTML.length : -1;"
  );
  const dialogCount = await driver.executeScript(
    "return document.querySelectorAll('[role=\"dialog\"]').length;"
  );
  const errors = await driver.executeScript("return window.__errors || [];");
  console.log(`[${label}] url=${url} rootChildren=${rootChildren} rootHTMLlen=${rootHTMLlen} dialogs=${dialogCount} errors=${JSON.stringify(errors)}`);
}

async function main(): Promise<void> {
  console.log("[recon] creating session...");
  const driver = await createDriver();
  try {
    await waitForElement(driver, '[aria-label="Minimize"]', { timeout: 30_000, visible: true });
    console.log("[recon] app ready");

    // Inject error capture
    await driver.executeScript(
      "window.__errors = [];" +
        "window.addEventListener('error', function(e) {" +
        "  window.__errors.push({type:'error', msg: e.message, src: (e.filename||'') + ':' + e.lineno + ':' + e.colno});" +
        "});" +
        "window.addEventListener('unhandledrejection', function(e) {" +
        "  window.__errors.push({type:'unhandledrejection', reason: String(e.reason && e.reason.message ? e.reason.message : e.reason)});" +
        "});"
    );
    await state(driver, "initial");

    // Click Sessions
    await driver.findElement(By.css('[aria-label="Sessions"]')).click();
    await new Promise((r) => setTimeout(r, 1000));
    await state(driver, "after-sessions-click");
    await shot(driver, "after-sessions-click");

    // Click New Session
    const ns = await driver.findElement(By.xpath('//button[contains(., "New Session")]'));
    await ns.click();
    console.log("[recon] clicked New Session");
    await new Promise((r) => setTimeout(r, 2000));
    await state(driver, "after-new-session-click");
    await shot(driver, "after-new-session-click");

    // Dump body HTML for inspection
    const html = await driver.executeScript("return document.body.outerHTML;");
    await writeFile(path.join(EVIDENCE, "recon-after-newsession.html"), String(html));
    console.log(`[recon] body HTML length: ${String(html).length}`);
  } finally {
    await driver.quit().catch(() => {});
  }
}

main().catch((e) => {
  console.error("[recon] fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
