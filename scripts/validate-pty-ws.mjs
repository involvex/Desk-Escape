/**
 * Smoke-test OpenCode PTY WebSocket (same path TerminalPanel uses).
 * Usage: bun scripts/validate-pty-ws.mjs [baseUrl] [directory]
 */
import { createOpencodeClient } from "@opencode-ai/sdk/client";

const baseUrl = process.argv[2] ?? "http://127.0.0.1:4096";
const directory = process.argv[3] ?? "D:\\repos\\opencode-plugins\\Desk-Escape";

const client = createOpencodeClient({
  baseUrl,
  responseStyle: "fields",
});

const project = await client.project.current();
const worktree = project.data?.worktree ?? directory;
console.log("worktree:", worktree);

const list = await client.pty.list({ query: { directory: worktree } });
let ptyId = list.data?.find((pty) => pty.status === "running")?.id;

if (!ptyId) {
  const created = await client.pty.create({
    query: { directory: worktree },
    body: { cwd: worktree, title: "Desk Escape validation" },
  });
  ptyId = created.data?.id;
}

if (!ptyId) {
  console.error("Failed to obtain PTY id");
  process.exit(1);
}

console.log("ptyId:", ptyId);

const httpUrl = new URL(`/pty/${ptyId}/connect`, `${baseUrl}/`);
httpUrl.searchParams.set("directory", worktree);
httpUrl.searchParams.set("cursor", "0");
httpUrl.protocol = httpUrl.protocol === "https:" ? "wss:" : "ws:";

const ws = new WebSocket(httpUrl.toString());
const timeout = setTimeout(() => {
  console.error("WebSocket timeout (no open within 10s)");
  ws.close();
  process.exit(1);
}, 10_000);

ws.addEventListener("open", () => {
  clearTimeout(timeout);
  console.log("WebSocket open:", httpUrl.toString());
  ws.send(JSON.stringify({ type: "input", data: "pwd\r" }));
});

ws.addEventListener("message", (event) => {
  const text =
    typeof event.data === "string" ? event.data : event.data.toString();
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
