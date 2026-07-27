/**
 * Connectivity self-check for the WSL -> Windows remote WebDriver stack.
 *
 * Verifies, with actionable diagnostics at each step:
 *   1. Windows host IP detection
 *   2. TCP reachability of the relay (/status endpoint)
 *   3. WebDriver session creation (tauri-driver launches xsterm.exe)
 *   4. Basic page sanity (.app-container renders) + screenshot round-trip
 *
 * Run:  npm run test:remote:check
 * Exit code 0 = everything works; 1 = failed step with printed remediation.
 */
import { By, WebDriver } from "selenium-webdriver";
import { writeFile, mkdir } from "node:fs/promises";
import {
  applicationPath,
  createDriver,
  detectWindowsHostIp,
  remoteWebDriverUrl,
} from "./driver.ts";

const SCREENSHOT_PATH = "test/remote/out/check.png";
const STEP_TIMEOUT_MS = 15_000;

let failures = 0;

function pass(step: string, detail = ""): void {
  console.log(`  PASS  ${step}${detail ? ` - ${detail}` : ""}`);
}

function fail(step: string, err: unknown, remediation: string): void {
  failures++;
  console.error(`  FAIL  ${step}`);
  console.error(`        ${err instanceof Error ? err.message : String(err)}`);
  console.error(`        -> ${remediation}`);
}

async function main(): Promise<void> {
  console.log("xsterm remote WebDriver self-check\n");

  // Step 1: host detection
  console.log("[1/4] Windows host detection");
  const ip = detectWindowsHostIp();
  if (ip) {
    pass("detected Windows host IP", ip);
  } else if (process.env.REMOTE_WEBDRIVER_URL) {
    pass("using REMOTE_WEBDRIVER_URL override");
  } else {
    fail(
      "auto-detect Windows host IP",
      new Error("no default route / resolv.conf nameserver found"),
      "Set REMOTE_WEBDRIVER_URL=http://<windows-ip>:4446 explicitly."
    );
  }

  const url = (() => {
    try {
      return remoteWebDriverUrl();
    } catch (err) {
      return null;
    }
  })();
  if (url) console.log(`       endpoint: ${url}`);

  // Step 2: relay reachability via WebDriver /status
  console.log("[2/4] relay / tauri-driver reachability");
  if (url) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), STEP_TIMEOUT_MS);
      const res = await fetch(`${url}/status`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { value?: { ready?: boolean } };
      pass("GET /status", `ready=${body.value?.ready ?? "unknown"}`);
    } catch (err) {
      fail(
        "GET /status",
        err,
        "On Windows run: powershell -ExecutionPolicy Bypass -File scripts\\windows\\start-webdriver.ps1\n" +
          "        If it is running, check Windows Firewall allows inbound TCP on the relay port (default 4446)."
      );
    }
  }

  // Step 3: session creation
  console.log("[3/4] WebDriver session (launches xsterm.exe on Windows)");
  let driver: WebDriver | null = null;
  if (failures === 0) {
    try {
      console.log(`       application: ${applicationPath()}`);
      driver = await createDriver();
      pass("session created", `title="${await driver.getTitle()}"`);
    } catch (err) {
      fail(
        "create session",
        err,
        "Check that TAURI_APPLICATION points to an existing Windows exe path (C:\\...). " +
          "If tauri-driver reports a driver mismatch, rerun start-webdriver.ps1 to reinstall msedgedriver."
      );
    }
  }

  // Step 4: page sanity + screenshot
  console.log("[4/4] page sanity + screenshot round-trip");
  if (driver) {
    try {
      const container = await driver.findElement(By.css(".app-container"));
      if (!(await container.isDisplayed())) {
        throw new Error(".app-container exists but is not visible");
      }
      pass(".app-container visible");

      await mkdir("test/remote/out", { recursive: true });
      const png = await driver.takeScreenshot();
      await writeFile(SCREENSHOT_PATH, Buffer.from(png, "base64"));
      pass("screenshot saved", SCREENSHOT_PATH);
    } catch (err) {
      fail(
        "page sanity / screenshot",
        err,
        "The app launched but the UI did not render as expected. " +
          "If you are using the debug exe, make sure the Vite dev server (npm run dev) is running ON WINDOWS."
      );
    }
  }

  if (driver) await driver.quit().catch(() => {});

  console.log(
    failures === 0
      ? "\nAll checks passed. The remote driving loop is ready: npm run test:remote:drive"
      : `\n${failures} check(s) failed - see remediation hints above.`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
