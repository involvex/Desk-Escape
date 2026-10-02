import { OpenCode } from "@opencode/client";
import type { OpenCodeClient } from "@opencode/client";

import { withOpenCodeErrors } from "./opencode/errors";
import { createAuthHeader, createV2Fetch } from "./opencode/transport";
import { normalizeBaseUrl, withLocation } from "./opencode/location";
import { bestSession } from "@/utils/session-ranking";
import type {
  ConnectionConfig,
  HealthResult,
  ParsedTarget,
} from "@/types/opencode";

const DEFAULT_PORT = 4096;
const DEFAULT_USERNAME = "opencode";

const clientCache = new Map<string, OpenCodeClient>();

export { createAuthHeader };

export function parseTarget(input: string): ParsedTarget {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Enter a host or URL.");
  }

  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;

  const url = new URL(withScheme);
  const port = url.port
    ? Number(url.port)
    : url.protocol === "https:"
      ? 443
      : DEFAULT_PORT;

  if (Number.isNaN(port)) {
    throw new Error("Invalid port in target URL.");
  }

  const baseUrl = `${url.protocol}//${url.hostname}:${port}`;

  return {
    baseUrl,
    host: url.hostname,
    port,
  };
}

export function buildConnectionConfig(
  target: string,
  options?: {
    username?: string;
    useAuth?: boolean;
  },
): ConnectionConfig {
  const parsed = parseTarget(target);

  return {
    type: "opencode",
    baseUrl: parsed.baseUrl,
    host: parsed.host,
    port: parsed.port,
    username: options?.username?.trim() || DEFAULT_USERNAME,
    useAuth: options?.useAuth ?? false,
  };
}

export function getClientCacheKey(config: ConnectionConfig): string {
  return `${config.baseUrl}:${config.username}:${config.useAuth}`;
}

/**
 * Create (or reuse) a V2 client for a connection.
 *
 * `OpenCode.make` is the only browser-safe entry point in `@opencode/client`:
 * it takes `{ baseUrl, fetch, headers }` and nothing else. There is no auth
 * option and no `responseStyle` -- V2 throws on failure and returns data
 * directly.
 */
export function createAuthenticatedClient(
  config: ConnectionConfig,
  password?: string,
): OpenCodeClient {
  const cacheKey = `${getClientCacheKey(config)}:${password ?? ""}`;
  const cached = clientCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const useAuth = Boolean(config.useAuth && password);

  const client = OpenCode.make({
    baseUrl,
    fetch: useAuth
      ? createV2Fetch({ username: config.username, password: password! })
      : undefined,
  });

  clientCache.set(cacheKey, client);
  return client;
}

export function clearClientCache(config?: ConnectionConfig): void {
  if (!config) {
    clientCache.clear();
    return;
  }

  const prefix = getClientCacheKey(config);
  for (const key of clientCache.keys()) {
    if (key.startsWith(prefix)) {
      clientCache.delete(key);
    }
  }
}

export interface PairingChallenge {
  code: string;
  expiresInSeconds: number;
}

export interface PairingToken {
  /**
   * The session token, which is used as the HTTP Basic **password**. The
   * username stays the server's configured username (default `opencode`).
   */
  token: string;
}

/**
 * Step 1 of pairing: ask the server for a short-lived code the user can enter
 * on this device.
 */
export async function createPairingCode(
  config: ConnectionConfig,
  password?: string,
): Promise<PairingChallenge> {
  const client = createAuthenticatedClient(config, password);
  const result = await withOpenCodeErrors(() => client.server.pair());
  return { code: result.code, expiresInSeconds: result.expires_in };
}

/**
 * Step 2 of pairing: redeem the code for a session token.
 */
export async function redeemPairingCode(
  config: ConnectionConfig,
  code: string,
): Promise<PairingToken> {
  // Redeeming happens against an unauthenticated client: the code *is* the
  // credential, and the server deliberately skips its credential check for
  // `/auth/connect/{code}`.
  const client = OpenCode.make({ baseUrl: normalizeBaseUrl(config.baseUrl) });
  const result = await withOpenCodeErrors(() =>
    client.server.connect({ code: code.trim() }),
  );
  return { token: result.token };
}

/**
 * Verify a server is reachable and actually usable.
 *
 * `GET /api/info` alone is not enough: a host can answer it while rejecting or
 * misrouting everything else. So probe `/api/info` for a version, then issue a
 * real list call to confirm the session endpoints work and the credentials are
 * accepted.
 */
export async function testConnection(
  config: ConnectionConfig,
  password?: string,
): Promise<HealthResult> {
  const client = createAuthenticatedClient(config, password);

  return withOpenCodeErrors(async () => {
    const info = await client.server.info();

    await client.session.list({ limit: 1 });

    return { healthy: true, version: info.version };
  });
}

/**
 * Resolve the session to chat in, creating one only when necessary.
 *
 * Note the location handling: session endpoints take no `location` parameter.
 * Scoping happens at creation time, so a session created without a `location`
 * lands in the server's default directory and later reads fail from the wrong
 * scope.
 */
export async function ensureSession(
  client: OpenCodeClient,
  preferredSessionId?: string,
  directory?: string | null,
): Promise<Awaited<ReturnType<OpenCodeClient["session"]["get"]>>> {
  return withOpenCodeErrors(async () => {
    if (preferredSessionId) {
      try {
        return await client.session.get({ sessionID: preferredSessionId });
      } catch {
        // Fall through to picking or creating one.
      }
    }

    // `session.list` filters by project/location using plain strings, unlike the
    // location-scoped endpoints that take a `location` object.
    const sessions = await client.session.list({
      ...(directory ? { directory } : {}),
    });
    const existing = bestSession(
      sessions.data as Parameters<typeof bestSession>[0],
    );

    if (existing) {
      return existing as Awaited<ReturnType<OpenCodeClient["session"]["get"]>>;
    }

    return client.session.create({
      title: "Desk Escape",
      ...(directory ? { location: { directory } } : {}),
    });
  });
}

/**
 * V2 removed `project.current()`. The closest equivalent is `location.get()`,
 * which resolves the requested location (or the server default) together with
 * the owning project.
 */
export async function fetchCurrentProject(
  client: OpenCodeClient,
  directory?: string | null,
) {
  return withOpenCodeErrors(async () => {
    const result = await client.location.get(withLocation(directory));
    return {
      worktree: result.directory,
      id: result.project.id,
      directory: result.project.directory,
    };
  });
}

export async function fetchProjectList(client: OpenCodeClient) {
  const projects = await withOpenCodeErrors(() => client.project.list());
  // V2 projects have no `worktree` field; `canonical` holds the project root
  // directory, which is what the project pickers switch on.
  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    vcs: project.vcs,
    worktree: project.canonical,
  }));
}

export function getWorktreeName(worktree?: string | null): string {
  if (!worktree) {
    return "No workspace";
  }

  const segments = worktree.replace(/\\/g, "/").split("/");
  return segments[segments.length - 1] || worktree;
}

export function configToTargetUrl(config: ConnectionConfig): string {
  return config.baseUrl;
}
