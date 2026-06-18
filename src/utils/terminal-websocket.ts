function encodeAuthToken(username: string, password: string): string {
  const value = `${username}:${password}`;
  if (typeof globalThis.btoa === "function") {
    return globalThis.btoa(value);
  }
  throw new Error("Base64 encoding is unavailable in this environment.");
}

export interface TerminalWebSocketInput {
  baseUrl: string;
  ptyId: string;
  directory: string;
  cursor?: number;
  username?: string;
  password?: string;
}

export function buildTerminalWebSocketUrl(
  input: TerminalWebSocketInput,
): string {
  const httpUrl = new URL(
    `/pty/${input.ptyId}/connect`,
    input.baseUrl.endsWith("/") ? input.baseUrl : `${input.baseUrl}/`,
  );
  httpUrl.searchParams.set("directory", input.directory);
  httpUrl.searchParams.set("cursor", String(input.cursor ?? 0));

  if (input.username && input.password) {
    httpUrl.searchParams.set(
      "auth_token",
      encodeAuthToken(input.username, input.password),
    );
  }

  httpUrl.protocol = httpUrl.protocol === "https:" ? "wss:" : "ws:";
  return httpUrl.toString();
}
