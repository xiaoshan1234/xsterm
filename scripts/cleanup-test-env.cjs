// Cross-platform dispatcher for the test-env cleanup script.
// Calls the PowerShell version on Windows and the bash version elsewhere.
// Exit code is propagated from the underlying script (0 = clean, 2 = skipped).
const { execSync } = require("node:child_process");

const isWin = process.platform === "win32";
const cmd = isWin
  ? "powershell -ExecutionPolicy Bypass -File scripts/windows/cleanup-test-env.ps1"
  : "bash scripts/cleanup-test-env.sh";

try {
  execSync(cmd, { stdio: "inherit" });
} catch (e) {
  // Preserve the underlying script's exit code (e.g. 2 for "skipped unrelated PIDs").
  process.exit(e.status || 1);
}
