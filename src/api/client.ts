import type { OpencodeClient, Session } from "@opencode-ai/sdk/client";
import { createOpencodeClient } from "@opencode-ai/sdk/client";
import { withDirectoryQuery } from "@/api/directory";
import type {
  ConnectionConfig,
  HealthResult,
  ParsedTarget,
} from "@/types/opencode";

const DEFAULT_PORT = 4096;
const DEFAULT_USERNAME = "opencode";

const clientCache = new Map<string, OpencodeClient>();

function encodeBasicAuth(username: string, password: string): string {
  const value = `${username}:${password}`;
  if (typeof globalThis.btoa === "function") {
    return globalThis.btoa(value);
  }
  throw new Error("Base64 encoding is unavailable in this environment.");
}

export function createAuthHeader(username: string, password: string): string {
  return `Basic ${encodeBasicAuth(username, password)}`;
}

function createAuthenticatedFetch(
  username: string,
  password: string,
): typeof fetch {
  const authorization = createAuthHeader(username, password);

  return (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", authorization);
    return fetch(input, { ...init, headers });
  };
}

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

export function createAuthenticatedClient(
  config: ConnectionConfig,
  password?: string,
): OpencodeClient {
  const cacheKey = `${getClientCacheKey(config)}:${password ?? ""}`;
  const cached = clientCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const client = createOpencodeClient({
    baseUrl: config.baseUrl,
    responseStyle: "fields",
    fetch:
      config.useAuth && password
        ? createAuthenticatedFetch(config.username, password)
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

export async function testConnection(
  config: ConnectionConfig,
  password?: string,
): Promise<HealthResult> {
  const client = createAuthenticatedClient(config, password);
  const configResult = await client.config.get();

  return {
    healthy: Boolean(configResult.data),
    version: undefined,
  };
}

export async function ensureSession(
  client: OpencodeClient,
  preferredSessionId?: string,
  directory?: string | null,
): Promise<Session> {
  const dirQuery = withDirectoryQuery(directory);

  if (preferredSessionId) {
    const preferred = await client.session.get({
      path: { id: preferredSessionId },
      ...dirQuery,
    });
    if (preferred.data) {
      return preferred.data;
    }
  }

  const sessions = await client.session.list(dirQuery);
  const existing = sessions.data?.[0];

  if (existing) {
    return existing;
  }

  const created = await client.session.create({
    ...dirQuery,
    body: { title: "Desk Escape" },
  });

  if (!created.data) {
    throw new Error("Failed to create an OpenCode session.");
  }

  return created.data;
}

export async function fetchCurrentProject(
  client: OpencodeClient,
  directory?: string | null,
) {
  const result = await client.project.current(withDirectoryQuery(directory));
  return result.data ?? null;
}

export async function fetchProjectList(client: OpencodeClient) {
  const result = await client.project.list();
  return result.data ?? [];
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
