#!/usr/bin/env node
/**
 * preflight.ts — xsterm UI-test stack readiness check
 *
 * Hard checks (failure → exit 1):
 *   [1] tauri-driver :4444 reachable  →  GET http://127.0.0.1:4444/sessions
 *   [2] Vite dev server :1420 reachable
 *   [3] debug exe exists               →  src-tauri/target/debug/xsterm.exe
 *
 * Soft checks (warn → exit 0):
 *   [4] SSH config present + host reachable
 *
 * Exit codes: 0 = all OK, 1 = hard failure
 */

import http from "node:http";
import path from "node:path";
import fs from "node:fs";

const TAURI_DRIVER_URL = "http://127.0.0.1:4444";
const VITE_URL = "http://localhost:1420";
// The debug exe. When running from WSL, the repo root is under /mnt/c/...;
// when running on Windows, it's C:\... . Resolve relative to the repo root
// (two levels up from this file's dir) using the OS-native path separator.
const EXE_PATH = path.join(import.meta.dirname, "..", "..", "src-tauri", "target", "debug", "xsterm.exe");
const SSH_CONFIG_PATH = path.join(import.meta.dirname, "ssh-config.json");
const STEP_TIMEOUT_MS = 5_000;

// ── helpers ─────────────────────────────────────────────────────────────────

function statusIcon(pass: boolean): string {
  return pass ? "✅" : "❌";
}

function log(prefix: string, msg: string): void {
  console.log(`  ${prefix}  ${msg}`);
}

async function httpGet(url: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const req = http.get(url, { signal: controller.signal }, (res) => {
      clearTimeout(timer);
      res.resume();
      resolve(res.statusCode !== undefined && res.statusCode < 500);
    });
    req.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

// ── checks ───────────────────────────────────────────────────────────────────

async function checkTauriDriver(): Promise<{ ok: boolean; hint: string }> {
  const url = `${TAURI_DRIVER_URL}/sessions`;
  const ok = await httpGet(url, STEP_TIMEOUT_MS);
  if (ok) {
    log(statusIcon(true), `tauri-driver reachable  ${url}`);
    return { ok: true, hint: "" };
  }
  log(
    statusIcon(false),
    `tauri-driver NOT reachable  ${url}`,
  );
  const hint =
    "On Windows run:\n" +
    "    powershell -ExecutionPolicy Bypass -File scripts\\windows\\start-webdriver.ps1\n" +
    "Or from WSL:\n" +
    "    bash scripts/start-webdriver.sh";
  console.log(hint);
  return { ok: false, hint };
}

async function checkVite(): Promise<{ ok: boolean; hint: string }> {
  // The app (xsterm.exe on Windows) connects to Vite via Windows localhost,
  // not WSL. Probe from the Windows side with PowerShell when available.
  // Allow VITE_CHECK_URL to override the probe target.
  if (process.env.VITE_CHECK_URL) {
    const ok = await httpGet(process.env.VITE_CHECK_URL, STEP_TIMEOUT_MS);
    if (ok) {
      log(statusIcon(true), `Vite dev server reachable  ${process.env.VITE_CHECK_URL}`);
      return { ok: true, hint: "" };
    }
  } else if (process.platform === "linux") {
    // Likely WSL → probe via powershell.exe on the Windows side.
    const { execFile } = await import("node:child_process");
    const psOk = await new Promise<boolean>((resolve) => {
      execFile(
        "powershell.exe",
        ["-NoProfile", "-Command", "try { (Invoke-WebRequest -UseBasicParsing http://localhost:1420 -TimeoutSec 4).StatusCode -lt 500 } catch { $false }"],
        { timeout: 8_000 },
        (err, stdout) => resolve(!err && /True/i.test(String(stdout))),
      );
    });
    if (psOk) {
      log(statusIcon(true), `Vite dev server reachable (Windows side)  http://localhost:1420`);
      return { ok: true, hint: "" };
    }
  } else {
    const ok = await httpGet(VITE_URL, STEP_TIMEOUT_MS);
    if (ok) {
      log(statusIcon(true), `Vite dev server reachable  ${VITE_URL}`);
      return { ok: true, hint: "" };
    }
  }
  log(
    statusIcon(false),
    `Vite dev server NOT reachable  http://localhost:1420`,
  );
  const hint =
    "On Windows run:\n    npm run dev\n" +
    "(if Vite IS running but this check fails, set VITE_CHECK_URL to a reachable URL)";
  console.log(hint);
  return { ok: false, hint };
}

async function checkExe(): Promise<{ ok: boolean; hint: string; mtime: string | null }> {
  try {
    const stats = await fs.promises.stat(EXE_PATH);
    const mtime = stats.mtime.toISOString();
    log(
      statusIcon(true),
      `debug exe exists  ${EXE_PATH}\n            mtime: ${mtime}`,
    );
    return { ok: true, hint: "", mtime };
  } catch {
    log(
      statusIcon(false),
      `debug exe NOT found  ${EXE_PATH}`,
    );
    const hint =
      "Build once on Windows to create the debug exe:\n" +
      "    npm run tauri dev\n" +
      "(stop immediately after the window appears — you only need the .exe)";
    console.log(hint);
    return { ok: false, hint, mtime: null };
  }
}

async function checkSsh(): Promise<{ ok: boolean; warn: string | null }> {
  const cfgPath = SSH_CONFIG_PATH;
  if (!fs.existsSync(cfgPath)) {
    log("ℹ️ ", `ssh-config.json not found — SSH tests will be skipped`);
    return { ok: true, warn: "ssh-config.json not found" };
  }

  // parse
  let cfg: Record<string, unknown>;
  try {
    cfg = JSON.parse(await fs.promises.readFile(cfgPath, "utf8"));
  } catch {
    log("⚠️ ", `ssh-config.json is not valid JSON — SSH tests will be skipped`);
    return { ok: true, warn: "invalid JSON" };
  }

  const host = String(cfg.host ?? "");
  const port = Number(cfg.port ?? 22);
  if (!host) {
    log("⚠️ ", `ssh-config.json has no "host" field — SSH tests will be skipped`);
    return { ok: true, warn: "no host" };
  }

  log(`🔌 Probing SSH host  ${host}:${port} …`);
  const reachable = await httpGet(`http://${host}:${port}`, 3_000);
  if (reachable) {
    log(statusIcon(true), `SSH host reachable  ${host}:${port}`);
  } else {
    log(
      "⚠️ ",
      `SSH host NOT reachable  ${host}:${port} — SSH tests will be skipped`,
    );
  }
  return { ok: true, warn: null };
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(
    "\n" +
      "═".repeat(60) + "\n" +
      "  xsterm UI-test preflight  \n" +
      "═".repeat(60) + "\n",
  );

  console.log("[1/4] tauri-driver reachability");
  const driverResult = await checkTauriDriver();
  console.log("[2/4] Vite dev server");
  const viteResult = await checkVite();
  console.log("[3/4] debug exe");
  const exeResult = await checkExe();
  console.log("[4/4] SSH config");
  const sshResult = await checkSsh();

  console.log("\n" + "─".repeat(60));
  const hardFail = !driverResult.ok || !viteResult.ok || !exeResult.ok;
  if (hardFail) {
    console.log(
      "\n❌  Preflight FAILED — one or more hard checks did not pass.\n" +
        "   Fix the issues above and re-run:\n" +
        "     npm run test:ui:preflight\n",
    );
    process.exit(1);
  }

  console.log(
    "\n✅  Preflight PASSED — the UI-test stack is ready.\n" +
      "   Run the full suite:\n" +
      "     npm run test:ui\n",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
