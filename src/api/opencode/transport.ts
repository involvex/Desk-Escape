import { V1RouteError } from "./errors";

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Build the HTTP Basic value for an OpenCode server.
 *
 * V2 keeps HTTP Basic auth with a default username of `opencode` (overridable
 * server-side via `OPENCODE_SERVER_USERNAME`). A pairing token is redeemed into
 * this same slot: it is used as the Basic *password*.
 */
export function createAuthHeader(username: string, password: string): string {
  const value = `${username}:${password}`;
  if (typeof globalThis.btoa === "function") {
    return `Basic ${globalThis.btoa(value)}`;
  }
  throw new Error("Base64 encoding is unavailable in this environment.");
}

function joinAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  a.addEventListener("abort", onAbort, { once: true });
  b.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}

function withTimeout(fetchFn: typeof fetch, timeoutMs: number): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const controller = new AbortController();
    const signal = init?.signal
      ? joinAbortSignals(init.signal, controller.signal)
      : controller.signal;

    const timer = setTimeout(() => controller.abort(), timeoutMs);

    return fetchFn(input, { ...init, signal }).finally(() => {
      clearTimeout(timer);
    });
  };
}

function describeRoute(input: RequestInfo | URL): string {
  try {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.pathname + input.search;
    const url = new URL((input as Request).url);
    return url.pathname + url.search;
  } catch {
    return String(input);
  }
}

export interface OpenCodeTransportOptions {
  username: string;
  password: string;
  timeoutMs?: number;
}

/**
 * The `fetch` implementation handed to `OpenCode.make`.
 *
 * Responsibilities:
 *  - inject the `Authorization` header (the V2 `ClientOptions` has no auth
 *    field, so credentials must be baked into `headers`/fetch);
 *  - apply a request timeout, merged with any caller-supplied abort signal;
 *  - fail loudly on the web-UI `text/html` fallback that V2 returns for unknown
 *    paths, which is how an un-migrated V1 route would otherwise look like a
 *    successful response.
 *
 * The V2 server streams events over `text/event-stream`, so only `text/html`
 * is treated as a mis-route.
 */
export function createV2Fetch(options: OpenCodeTransportOptions): typeof fetch {
  const authorization = createAuthHeader(options.username, options.password);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const baseFetch: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", authorization);

    const response = await fetch(input, { ...init, headers });

    const contentType = response.headers.get("content-type") ?? "";

    if (response.status === 401 || response.status === 403) {
      // A 401 here is almost always a username mismatch, and the server says
      // only "Authentication required", which gives no way to tell the
      // credentials apart. Log what was actually sent -- never the password or
      // the header itself, only the decoded username -- so a mismatch is
      // visible in the Metro console instead of requiring guesswork.
      console.warn(
        `[opencode] ${response.status} from ${describeRoute(input)} ` +
          `as user "${options.username}" (password supplied: ${
            options.password.length > 0
          }). The server username defaults to "opencode" and is set by ` +
          `OPENCODE_SERVER_USERNAME -- it is NOT the "username" field in ` +
          `opencode.json.`,
      );
    }

    if (contentType.includes("text/html")) {
      // Drain so the socket can be reused rather than left half-read.
      await response.body?.cancel().catch(() => undefined);
      throw new V1RouteError(describeRoute(input));
    }

    return response;
  };

  return timeoutMs > 0 ? withTimeout(baseFetch, timeoutMs) : baseFetch;
}
