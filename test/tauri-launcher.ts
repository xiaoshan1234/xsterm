/**
 * tauri-launcher.ts — WSL-safe `npm run tauri dev` lifecycle manager
 *
 * Provides startTauriDev() / stopTauriDev() for test files that need to
 * manage the Tauri dev server process from WSL.
 *
 * Key design:
 *   - Uses powershell.exe -NoProfile to invoke npm (node.exe can't resolve
 *     /mnt/c/... paths correctly)
 *   - Clears port 1420 before starting (strictPort: true means Vite fails
 *     if the port is occupied)
 *   - Waits for Vite readiness by polling http://localhost:1420
 *   - stopTauriDev() uses taskkill /T /F on Windows to kill the entire
 *     process tree (powershell → npm → node/vite → cargo → xsterm)
 */

import { spawn, execSync } from "node:child_process";
import http from "node:http";

const VITE_PORT = 1420;
const DEFAULT_TIMEOUT_MS = 180_000;

function windowsCwd(): string {
  return process.cwd().replace(/^\/mnt\/c/, "C:").replace(/\//g, "/");
}

function isPortActive(port: number): boolean {
  try {
    const out =
      process.platform === "linux"
        ? execSync(
            `powershell.exe -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Measure-Object | Select-Object -ExpandProperty Count"`,
            { encoding: "utf-8", timeout: 5000 },
          ).trim()
        : "";
    return Number(out) > 0;
  } catch {
    return false;
  }
}

function killPort(port: number): void {
  try {
    execSync(
      `powershell.exe -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"`,
      { encoding: "utf-8", timeout: 10_000 },
    );
  } catch {
    // best-effort
  }
}

function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Timed out waiting for ${url} after ${timeoutMs}ms`));
        return;
      }
      const req = http.get(url, { timeout: 2000 }, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) {
          resolve();
        } else {
          setTimeout(check, 1000);
        }
      });
      req.on("error", () => setTimeout(check, 1000));
      req.setTimeout(2000, () => {
        req.destroy();
        setTimeout(check, 1000);
      });
    };
    check();
  });
}

export interface TauriDevProcess {
  pid: number;
  stop: () => Promise<void>;
}

/**
 * Start `npm run tauri dev` via PowerShell (WSL-safe).
 *
 * 1. Clears port 1420 if occupied (leftover Vite from a previous run).
 * 2. Spawns `powershell.exe -NoProfile -Command "Set-Location ...; npm run tauri dev"`
 *    detached so it survives the parent process.
 * 3. Polls http://localhost:1420 until Vite responds.
 *
 * Returns a TauriDevProcess with a stop() method that kills the entire
 * process tree via `taskkill /T /F`.
 */
export async function startTauriDev(
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<TauriDevProcess> {
  if (isPortActive(VITE_PORT)) {
    console.log(`  ⚠ Port ${VITE_PORT} occupied — clearing…`);
    killPort(VITE_PORT);
    await new Promise((r) => setTimeout(r, 1500));
  }

  const winCwd = windowsCwd();

  const proc = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Set-Location '${winCwd}'; npm run tauri dev`,
    ],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    },
  );

  proc.unref();

  if (!proc.pid) {
    throw new Error("Failed to spawn powershell.exe for tauri dev");
  }

  console.log(`  ⏳ Waiting for Vite on http://localhost:${VITE_PORT} …`);
  await waitForServer(`http://localhost:${VITE_PORT}`, timeoutMs);
  console.log(`  ✅ Vite ready (pid ${proc.pid})`);

  return {
    pid: proc.pid,
    stop: () => stopTauriDev(proc.pid),
  };
}

export async function stopTauriDev(pid: number): Promise<void> {
  try {
    if (process.platform === "win32" || process.platform === "linux") {
      execSync(`taskkill.exe //F //T //PID ${pid}`, {
        stdio: "ignore",
        timeout: 10_000,
      });
    } else {
      process.kill(-pid, "SIGTERM");
    }
  } catch {
    // already exited
  }
}
