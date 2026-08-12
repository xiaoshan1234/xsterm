/**
 * Spike probe — validates the three load-bearing assumptions for the
 * xsterm UI test automation stack before any real test code is written.
 *
 *   A1: xterm DOM renderer is readable in WebView2
 *       (.xterm-rows text can be extracted after a PTY round-trip)
 *   A2: tauri-driver auto-launches the app (no manual xsterm.exe start)
 *   A3: key aria-label / role / title selectors resolve in WebView2
 *
 * Run:
 *   node --experimental-strip-types --test test/sys-test/spike/probe.spec.ts
 *
 * Preconditions (Windows side):
 *   - Vite dev server on :1420  (npm run dev)
 *   - tauri-driver on :4444     (scripts/windows/start-webdriver.ps1)
 *   - xsterm.exe must NOT be started manually (A2 verifies auto-launch)
 *
 * Reuses:
 *   - createDriver()        from test/remote/driver.ts
 *   - waitForElement/waitUntil  from test/sys-test/lib/harness.ts
 *   - selector constants    from test/sys-test/lib/selectors.ts
 *
 * If A1 FAILs, the probe stops downstream checks and reports — do NOT
 * proceed to implementation tasks; the DOM-renderer assumption is broken.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { By, Key, WebDriver } from "selenium-webdriver";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createDriver } from "../../remote/driver.ts";
import { waitForElement, waitUntil } from "../lib/harness.ts";
import { NAV, SIDEBAR, DIALOG, TAB, TERMINAL } from "../lib/selectors.ts";

// ── shared state across the sequential test sequence ─────────────────────────
//
// node:test runs `it()` subtests of a `describe` sequentially by default,
// so later tests can rely on UI state established by earlier ones (sidebar
// panel opened, dialog opened, terminal created, ...).
const state: {
  driver: WebDriver | null;
  marker: string;
  terminalReady: boolean;
  a1Failed: boolean;
} = {
  driver: null,
  marker: "",
  terminalReady: false,
  a1Failed: false,
};

const EVIDENCE_DIR = path.join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  ".omo",
  "evidence"
);

/** Capture screenshot + body HTML + .xterm-rows text on failure. Best-effort. */
async function captureEvidence(label: string): Promise<void> {
  const driver = state.driver;
  if (!driver) return;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const base = path.join(EVIDENCE_DIR, `probe-${label}-${ts}`);
  try {
    await mkdir(EVIDENCE_DIR, { recursive: true });
    const png = await driver.takeScreenshot();
    await writeFile(base + ".png", Buffer.from(png, "base64"));
    const html = await driver.executeScript("return document.body.outerHTML;");
    await writeFile(base + ".html", String(html));
    const rows = await driver.findElements(By.css(TERMINAL.rows));
    const texts = await Promise.all(rows.map((el) => el.getText()));
    await writeFile(
      base + ".txt",
      texts.length ? texts.join("\n---\n") : "(no .xterm-rows elements)"
    );
    console.log(`[evidence] captured -> ${base}.{png,html,txt}`);
  } catch (err) {
    console.log(`[evidence] capture failed: ${err instanceof Error ? err.message : err}`);
  }
}

/** Dump every aria-label present in the DOM — diagnostic for selector design. */
async function dumpAriaLabels(driver: WebDriver, label: string): Promise<string[]> {
  const labels = (await driver.executeScript(
    "return Array.from(document.querySelectorAll('[aria-label]'))" +
      ".map(e => ({tag: e.tagName.toLowerCase(), label: e.getAttribute('aria-label')}));"
  )) as { tag: string; label: string | null }[];
  const flat = labels.map((l) => `${l.tag}[${l.label}]`);
  console.log(`[diag:${label}] aria-labels (${flat.length}): ${JSON.stringify(flat)}`);
  return flat.map((f) => f);
}

/** Count elements matching a CSS selector (never throws). */
async function countOf(driver: WebDriver, css: string): Promise<number> {
  return (await driver.findElements(By.css(css))).length;
}

describe("spike probe", () => {
  before(async () => {
    // A2 begins here: createDriver() asks tauri-driver to launch xsterm.exe.
    // We do NOT start the app manually. If the stack is down, this throws fast.
    console.log("[probe] creating WebDriver session (tauri-driver launches app)...");
    state.driver = await createDriver();
    console.log("[probe] session created.");
  });

  after(async () => {
    if (state.driver) {
      await state.driver.quit().catch(() => {});
      state.driver = null;
    }
  });

  // ── A2: tauri-driver auto-launches the app ───────────────────────────────
  it("A2: tauri-driver auto-launches xsterm (NavBar Minimize visible within 30s)", async () => {
    const driver = state.driver!;
    // The app-ready signal: NavBar Minimize button appears. 30s timeout
    // matches the harness APP_READY_TIMEOUT_MS. If this fails, either the
    // app didn't launch (A2 FAIL) or Vite isn't serving (blank window).
    const minimize = await waitForElement(driver, NAV.minimize, {
      timeout: 30_000,
      visible: true,
    });
    const displayed = await minimize.isDisplayed();
    assert.ok(displayed, "Minimize button not displayed");
    console.log("[A2] PASS — app auto-launched, NavBar Minimize visible");
  });

  // ── A3 (NavBar-level): key selectors resolve in WebView2 ──────────────────
  it("A3a: NavBar-level selectors resolve (Minimize, header Close, New window)", async () => {
    const driver = state.driver!;
    await dumpAriaLabels(driver, "after-app-ready");

    const checks: { name: string; css: string }[] = [
      { name: "NavBar Minimize", css: NAV.minimize },
      { name: "NavBar Close (scoped to header)", css: NAV.close },
      { name: "New window button (title)", css: TAB.newWindow },
    ];
    const results: string[] = [];
    for (const c of checks) {
      const n = await countOf(driver, c.css);
      results.push(`${c.name}=${n}`);
    }
    console.log(`[A3a] selector counts: ${results.join(", ")}`);
    for (const c of checks) {
      const n = await countOf(driver, c.css);
      assert.ok(n >= 1, `${c.name} (${c.css}) resolved 0 elements`);
    }
    console.log("[A3a] PASS — NavBar-level selectors resolve in WebView2");
  });

  // ── Open dialog + A3 (dialog-level) + ambiguity ──────────────────────────
  it("A3b: dialog open → role=dialog & role=tab resolve; Close ambiguity scoped", async () => {
    const driver = state.driver!;

    // 1. Open the Sessions sidebar panel (initial sidebarPanel is null).
    //    SIDEBAR.sessions = [aria-label="Sessions"] (MUI Tooltip title).
    const sessionsBtns = await driver.findElements(By.css(SIDEBAR.sessions));
    console.log(`[A3b] Sessions button count=${sessionsBtns.length}`);
    if (sessionsBtns.length === 0) {
      await dumpAriaLabels(driver, "no-sessions-button");
      await captureEvidence("no-sessions-btn");
    }
    assert.ok(sessionsBtns.length >= 1, "Sessions toolbar button not found");
    await sessionsBtns[0].click();

    // 2. Click "New Session" (SessionManager footer button, text-based).
    const newSessionBtn = await waitUntil(async () => {
      const els = await driver.findElements(
        By.xpath('//button[contains(., "New Session")]')
      );
      return els.length > 0 ? els[0] : false;
    }, { timeout: 5_000, message: "New Session button not found" });
    await newSessionBtn.click();

    // 3. Wait for the CreateSessionDialog (MUI Dialog → role="dialog").
    await waitForElement(driver, DIALOG.root, { timeout: 5_000 });
    console.log("[A3b] CreateSessionDialog opened (role=dialog present)");

    // 4. role=tab resolves (Local Shell + SSH tabs).
    const tabCount = await countOf(driver, TAB.root);
    assert.ok(tabCount >= 2, `role=tab count=${tabCount} (expected >=2)`);

    // 5. Ambiguity: NavBar Close vs Dialog Close.
    //    Unscoped [aria-label="Close"] should match BOTH (==2 when one dialog).
    //    Scoped selectors must each hit exactly one.
    const navClose = await countOf(driver, NAV.close); // header [aria-label="Close"]
    const dlgClose = await countOf(driver, DIALOG.close); // [role="dialog"] [aria-label="Close"]
    const allClose = await countOf(driver, '[aria-label="Close"]');
    console.log(
      `[A3b] Close counts: header-scoped=${navClose}, dialog-scoped=${dlgClose}, unscoped=${allClose}`
    );
    assert.equal(navClose, 1, `header [aria-label="Close"] count=${navClose} (expected 1)`);
    assert.equal(dlgClose, 1, `[role="dialog"] [aria-label="Close"] count=${dlgClose} (expected 1)`);
    assert.ok(allClose >= 2, `unscoped [aria-label="Close"] count=${allClose} (expected >=2)`);

    // Also verify the dialog-level selectors from the task's A3 list.
    const dialogCount = await countOf(driver, DIALOG.root);
    assert.ok(dialogCount >= 1, "role=dialog resolved 0");
    console.log("[A3b] PASS — dialog selectors resolve, Close ambiguity scoped correctly");
  });

  // ── A1: xterm DOM renderer readable (.xterm-rows contains echo marker) ────
  it("A1: xterm DOM renderer readable — .xterm-rows contains echo marker", async () => {
    const driver = state.driver!;
    try {
      // 1. Ensure the Local Shell tab is active (default-selected, but click
      //    to be explicit and to verify the tab is interactable).
      const localTab = await driver.findElement(
        By.xpath('//*[@role="tab" and contains(., "Local Shell")]')
      );
      await localTab.click();
      console.log("[A1] clicked Local Shell tab");

      // 2. Click Create (scoped to the dialog to avoid any stray match).
      const createBtn = await driver.findElement(
        By.xpath('//*[@role="dialog"]//button[contains(., "Create")]')
      );
      await createBtn.click();
      console.log("[A1] clicked Create — spawning local PTY session");

      // 3. Wait for the xterm terminal to mount (.xterm-rows appears).
      await waitForElement(driver, TERMINAL.rows, { timeout: 15_000 });
      console.log("[A1] .xterm-rows element present");

      // 4. Wait for non-empty content (shell prompt / banner rendered).
      //    This proves the DOM renderer captured PTY output even before echo.
      await waitUntil(async () => {
        const rows = await driver.findElements(By.css(TERMINAL.rows));
        if (rows.length === 0) return false;
        const text = await rows[0].getText();
        return text.trim().length > 0 ? text : false;
      }, { timeout: 15_000, message: ".xterm-rows empty (no prompt rendered)" });
      console.log("[A1] .xterm-rows has non-empty content (prompt rendered)");

      // 5. Send an echo command through the xterm input channel.
      //    Marker is a JS-generated literal (shell-agnostic: works in
      //    PowerShell, cmd, and bash without variable expansion).
      state.marker = "SPIKE_OK_" + Math.floor(Math.random() * 1_000_000);
      const textarea = await driver.findElement(By.css(TERMINAL.input));
      // Focus the hidden textarea via JS, then send keys. xterm captures
      // keydown events on this textarea and forwards them to the PTY.
      await driver.executeScript("arguments[0].focus()", textarea);
      try {
        await textarea.sendKeys(`echo ${state.marker}`, Key.ENTER);
      } catch {
        // ElementNotInteractable fallback: use the actions API on the
        // focused element (the textarea we just focused via JS).
        await driver
          .actions()
          .sendKeys(`echo ${state.marker}`)
          .sendKeys(Key.ENTER)
          .perform();
      }
      console.log(`[A1] sent: echo ${state.marker} + ENTER`);

      // 6. Wait for the marker to appear in .xterm-rows text. This is the
      //    critical A1 assertion: PTY output rendered into the DOM.
      const found = await waitUntil(async () => {
        const rows = await driver.findElements(By.css(TERMINAL.rows));
        if (rows.length === 0) return false;
        const text = await rows[0].getText();
        return text.includes(state.marker) ? text : false;
      }, { timeout: 15_000, message: `marker "${state.marker}" not found in .xterm-rows` });

      state.terminalReady = true;
      console.log(`[A1] PASS — marker "${state.marker}" read from .xterm-rows`);
      console.log(`[A1] .xterm-rows excerpt: ${found.slice(0, 200).replace(/\n/g, "\\n")}`);
    } catch (err) {
      state.a1Failed = true;
      await captureEvidence("a1-fail");
      throw err;
    }
  });

  // ── Input channel: sendKeys to .xterm-helper-textarea produces echo ───────
  it("input channel: sendKeys to .xterm-helper-textarea produces echo in .xterm-rows", async () => {
    if (state.a1Failed) {
      console.log("[input] SKIP — A1 failed, cannot verify input channel");
      // Still assert (fail) so the test reports FAIL, not silently pass.
      assert.fail("A1 failed — input channel unverifiable (DOM renderer not readable)");
    }
    const driver = state.driver!;
    assert.ok(state.terminalReady, "terminal not ready");

    // The typed command string itself must appear in .xterm-rows (local echo
    // from the PTY). This proves sendKeys → textarea → xterm → PTY → echo →
    // DOM render is a working round-trip.
    const rows = await driver.findElements(By.css(TERMINAL.rows));
    assert.ok(rows.length > 0, ".xterm-rows missing");
    const text = await rows[0].getText();
    const typedCmd = `echo ${state.marker}`;
    assert.ok(
      text.includes(typedCmd),
      `typed command "${typedCmd}" not echoed in .xterm-rows (local echo missing)`
    );
    console.log(`[input] PASS — typed "${typedCmd}" echoed in .xterm-rows`);
  });
});

// ── summary hook ─────────────────────────────────────────────────────────────
//
// node:test doesn't have a built-in "after all tests" summary printer that
// runs even on failure, so we register a process exit handler that prints a
// compact PASS/FAIL recap. This makes the 5 verifications easy to transcribe
// into spike-results.md.
process.on("exit", () => {
  console.log("\n========== SPIKE PROBE SUMMARY ==========");
  console.log("A2  (app auto-launch)        : see test results above");
  console.log("A3a (NavBar selectors)        : see test results above");
  console.log("A3b (dialog selectors+ambig)  : see test results above");
  console.log("A1  (xterm DOM readable)      : see test results above");
  console.log("input (helper-textarea echo)  : see test results above");
  console.log(`A1 failed flag: ${state.a1Failed}`);
  console.log("=========================================\n");
});
