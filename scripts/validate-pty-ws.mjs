/**
 * Smoke-test the OpenCode V2 PTY WebSocket (same handshake TerminalPanel uses).
 *
 * Usage:
 *   bun scripts/validate-pty-ws.mjs [baseUrl] [directory]
 *   bun scripts/validate-pty-ws.mjs [baseUrl] [directory] --user <u> --pass <p>
 *
 * Credentials can also come from OPENCODE_USERNAME / OPENCODE_PASSWORD. Without
 * them this fails with `UnauthorizedError` against any password-protected
 * server, because `OpenCode.make` takes no auth option -- credentials must be
 * supplied as an `Authorization` header.
 *
 * V2 replaced V1's `?auth_token=<base64(user:pass)>` socket query parameter with
 * a short-lived ticket obtained over HTTP:
 *   1. `POST /api/pty/{id}/connect-token` with `x-opencode-ticket: 1`
 *   2. `ws(s)://<host>/api/pty/{id}/connect?ticket=...&location[directory]=...`
 */
import { OpenCode } from "@opencode/client";

// Mirrors `createAuthHeader` in src/api/opencode/transport.ts. V2 keeps HTTP
// Basic auth; the default username is "opencode", which is NOT the "username"
// field in opencode.json (that one configures something else entirely).
function createAuthHeader(username, password) {
  // btoa only accepts latin1, so encode to bytes first to stay correct for
  // non-ASCII passwords.
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `Basic ${globalThis.btoa(binary)}`;
}

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const positional = argv.filter(
  (a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"),
);

const baseUrl = positional[0] ?? "http://127.0.0.1:4096";
const directory = positional[1] ?? "D:\\repos\\opencode-plugins\\Desk-Escape";

const username = flag("--user") ?? process.env.OPENCODE_USERNAME;
const password = flag("--pass") ?? process.env.OPENCODE_PASSWORD;

const normalizeBaseUrl = (value) => value.replace(/\/+$/, "");
const withLocation = (dir) => (dir ? { location: { directory: dir } } : {});

if (username && password) {
  console.log(`auth: ${username}:*** (HTTP Basic)`);
} else {
  console.log(
    "auth: none supplied (set --user/--pass if the server is protected)",
  );
}

const client = OpenCode.make({
  baseUrl: normalizeBaseUrl(baseUrl),
  ...(username && password
    ? {
        headers: { Authorization: createAuthHeader(username, password) },
      }
    : {}),
});

const location = await client.location.get(withLocation(directory));
const worktree = location.directory ?? directory;
console.log("worktree:", worktree);

const listed = await client.pty.list(withLocation(worktree));
let ptyId = listed.data?.find((pty) => pty.status === "running")?.id;

if (!ptyId) {
  const created = await client.pty.create({
    ...withLocation(worktree),
    cwd: worktree,
    title: "Desk Escape validation",
  });
  ptyId = created.data?.id;
}

if (!ptyId) {
  console.error("Failed to obtain PTY id");
  process.exit(1);
}

console.log("ptyId:", ptyId);

const token = await client.pty.connect.token({
  ptyID: ptyId,
  ...withLocation(worktree),
  "x-opencode-ticket": "1",
});
console.log(
  "ticket:",
  `${token.data.ticket.slice(0, 8)}… (expires in ${token.data.expires_in}s)`,
);

const base = new URL(
  normalizeBaseUrl(baseUrl).endsWith("/")
    ? normalizeBaseUrl(baseUrl)
    : `${normalizeBaseUrl(baseUrl)}/`,
);
const httpUrl = new URL(`api/pty/${encodeURIComponent(ptyId)}/connect`, base);
if (worktree) {
  httpUrl.searchParams.set("location[directory]", worktree);
}
httpUrl.searchParams.set("cursor", "0");
httpUrl.searchParams.set("ticket", token.data.ticket);
httpUrl.protocol = httpUrl.protocol === "https:" ? "wss:" : "ws:";

const ws = new WebSocket(httpUrl.toString());
ws.binaryType = "arraybuffer";

const timeout = setTimeout(() => {
  console.error("WebSocket timeout (no open within 10s)");
  ws.close();
  process.exit(1);
}, 10_000);

ws.addEventListener("open", () => {
  clearTimeout(timeout);
  console.log("WebSocket open:", httpUrl.toString());
  // Raw keystrokes, matching what the injected xterm shell writes to the socket.
  ws.send("pwd\r");
});

const decoder = new TextDecoder();

ws.addEventListener("message", (event) => {
  const text =
    typeof event.data === "string"
      ? event.data
      : decoder.decode(new Uint8Array(event.data));
  console.log("message:", text.slice(0, 200));
  if (text.includes("Desk-Escape") || text.includes("opencode-plugins")) {
    console.log("PTY shell I/O OK");
    ws.close();
    process.exit(0);
  }
});

ws.addEventListener("error", (event) => {
  clearTimeout(timeout);
  console.error("WebSocket error", event.message ?? event);
  process.exit(1);
});

ws.addEventListener("close", (event) => {
  clearTimeout(timeout);
  console.log("WebSocket closed", event.code, event.reason);
});
