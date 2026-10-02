/**
 * WebSocket URL builder for the OpenCode V2 PTY stream.
 *
 * V1 authenticated the socket with `?auth_token=<base64(user:pass)>`, reusing the
 * HTTP Basic pair in a query parameter. V2 removed that scheme entirely. The
 * handshake is now:
 *
 *  1. `POST /api/pty/{ptyID}/connect-token` (sending the `x-opencode-ticket: 1`
 *     header) returns a short-lived `{ ticket, expires_in }`;
 *  2. the socket is opened at
 *     `ws(s)://<host>/api/pty/{ptyID}/connect?ticket=<ticket>&location[directory]=<dir>&cursor=<n>`.
 *
 * The route also moved under the `/api` prefix, and the flat V1
 * `?directory=<path>` became the deepObject `location[directory]`.
 *
 * See `requestPtyConnectTicket` in `@/api/use-pty-session` for step 1, and
 * `buildTerminalWebSocketUrl` below for step 2 — the pair is a direct port of
 * the reference implementation shipped as `createPtyClient` in
 * `@opencode/client/solid`.
 */
export interface TerminalWebSocketInput {
  baseUrl: string;
  ptyId: string;
  /** Short-lived connect ticket from `pty.connect.token`. */
  ticket: string;
  /** Working directory / location scope. Omitted from the URL when unset. */
  directory?: string;
  /** Replay cursor. Omitted from the URL when `undefined`. */
  cursor?: number;
}

export function buildTerminalWebSocketUrl(
  input: TerminalWebSocketInput,
): string {
  if (!input.ptyId) {
    throw new Error("Missing PTY id.");
  }
  if (!input.ticket) {
    throw new Error(
      "OpenCode did not issue a PTY connect ticket. Reconnect the terminal.",
    );
  }

  const base = new URL(
    input.baseUrl.endsWith("/") ? input.baseUrl : `${input.baseUrl}/`,
  );
  const wsUrl = new URL(
    `api/pty/${encodeURIComponent(input.ptyId)}/connect`,
    base,
  );

  if (input.directory) {
    wsUrl.searchParams.set("location[directory]", input.directory);
  }
  if (input.cursor !== undefined) {
    wsUrl.searchParams.set("cursor", String(input.cursor));
  }
  wsUrl.searchParams.set("ticket", input.ticket);

  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
  return wsUrl.toString();
}
