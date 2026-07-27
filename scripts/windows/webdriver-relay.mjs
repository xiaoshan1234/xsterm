// Zero-dependency TCP relay: exposes the loopback-only tauri-driver
// (127.0.0.1:4444) on a LAN/WSL-reachable address.
//
// tauri-driver hard-codes its listener to 127.0.0.1 with no --bind option,
// so WSL cannot reach it directly. This relay listens on 0.0.0.0 and pipes
// bytes to the loopback driver.
//
// Usage (on Windows, from repo root):
//   node scripts/windows/webdriver-relay.mjs
//
// Env overrides: RELAY_HOST, RELAY_PORT, TARGET_HOST, TARGET_PORT
import net from "node:net";

const RELAY_HOST = process.env.RELAY_HOST ?? "0.0.0.0";
const RELAY_PORT = Number(process.env.RELAY_PORT ?? 4446);
const TARGET_HOST = process.env.TARGET_HOST ?? "127.0.0.1";
const TARGET_PORT = Number(process.env.TARGET_PORT ?? 4444);

let connections = 0;

const server = net.createServer((client) => {
  const id = ++connections;
  const upstream = net.connect(TARGET_PORT, TARGET_HOST, () => {
    client.pipe(upstream);
    upstream.pipe(client);
  });

  const teardown = (err) => {
    if (err) {
      console.error(`[relay #${id}] ${err.message}`);
    }
    client.destroy();
    upstream.destroy();
  };

  client.on("error", teardown);
  upstream.on("error", teardown);
});

server.on("error", (err) => {
  console.error(`[relay] failed to listen on ${RELAY_HOST}:${RELAY_PORT}: ${err.message}`);
  process.exit(1);
});

server.listen(RELAY_PORT, RELAY_HOST, () => {
  console.log(`[relay] listening on ${RELAY_HOST}:${RELAY_PORT} -> ${TARGET_HOST}:${TARGET_PORT}`);
  console.log("[relay] WSL clients should use this port. Press Ctrl+C to stop.");
});
