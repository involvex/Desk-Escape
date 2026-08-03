# Cursor Cloud Agents Dual-Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Cursor Cloud Agents as a second agent backend alongside OpenCode, with separate connection flows and a shared workspace UI.

**Architecture:** Introduce an `AgentProvider` interface that both OpenCode and Cursor implementations satisfy. Refactor `ConnectionContext` to be provider-agnostic. Add a new Cursor Cloud Agents API client that maps Cursor's agent/run model to Desk Escape's session/message model. The connection screen gains a provider selector that routes to the appropriate connection flow.

**Tech Stack:** React Native 0.86, Expo SDK 57, TypeScript 6, React Query 5, `@opencode-ai/sdk/client` (existing), Cursor Cloud Agents REST API v1 (`https://api.cursor.com/v1/`)

## Global Constraints

- Expo SDK 57 stable (`~57.0.8`), React Native 0.86.0, TypeScript ~6.0.3
- Bun for installs and scripts; do not use npm/yarn/pnpm
- React Navigation native stack (not Expo Router)
- Do not git commit or push unless explicitly requested
- Do not edit implementation plan files when executing — implement from this plan as reference only
- Package manager: `bun install`, `bun run`, `bunx`
- Cursor Cloud Agents API: Basic Auth with API key as username, empty password; base URL `https://api.cursor.com`

---

## File Structure

### New Files

| File                                           | Responsibility                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| `src/api/providers/types.ts`                   | `AgentProvider` interface and provider-agnostic types               |
| `src/api/providers/opencode/provider.ts`       | OpenCode implementation of `AgentProvider`                          |
| `src/api/providers/opencode/client.ts`         | Thin wrapper extracting OpenCode SDK logic from `src/api/client.ts` |
| `src/api/providers/opencode/hooks.ts`          | React Query hooks (extracted/adapted from `src/api/hooks.ts`)       |
| `src/api/providers/opencode/event-bus.ts`      | SSE subscription (extracted from `src/api/event-bus.ts`)            |
| `src/api/providers/opencode/message-stream.ts` | Event processing (extracted from `src/api/message-stream.ts`)       |
| `src/api/providers/cursor/provider.ts`         | Cursor implementation of `AgentProvider`                            |
| `src/api/providers/cursor/client.ts`           | Cursor Cloud Agents REST API client                                 |
| `src/api/providers/cursor/hooks.ts`            | React Query hooks for Cursor agents/runs                            |
| `src/api/providers/cursor/event-bus.ts`        | SSE streaming for Cursor run events                                 |
| `src/api/providers/cursor/message-stream.ts`   | Adapt Cursor events to `MessageWithParts`                           |
| `src/api/providers/cursor/types.ts`            | Cursor API request/response types                                   |
| `src/screens/CursorConnectionScreen.tsx`       | Connection screen for Cursor (API key, repo URL, model)             |
| `src/screens/ProviderPickerScreen.tsx`         | Initial screen to choose OpenCode or Cursor                         |
| `src/components/CursorAgentChat.tsx`           | Cursor-specific chat adaptations (thinking blocks, tool calls)      |

### Modified Files

| File                                | Changes                                                       |
| ----------------------------------- | ------------------------------------------------------------- |
| `src/context/ConnectionContext.tsx` | Provider-agnostic; delegates to active `AgentProvider`        |
| `src/types/opencode.ts`             | Add `AgentProviderType`, update `ConnectionConfig` for Cursor |
| `src/navigation/RootNavigator.tsx`  | Add `ProviderPicker` and `CursorConnection` routes            |
| `src/screens/ConnectionScreen.tsx`  | Minor: add "Back to providers" navigation option              |
| `src/screens/WorkspaceScreen.tsx`   | Use provider-agnostic hooks; hide PTY/files for Cursor        |
| `src/components/AgentChat.tsx`      | Use provider-agnostic message hooks                           |
| `src/components/PanelTabs.tsx`      | Conditionally hide terminal/files panel for Cursor            |
| `src/api/hooks.ts`                  | Thin re-export wrapper over provider-specific hooks           |

### Deleted/Deprecated Files (after migration)

None — old files become thin re-exports to avoid breaking changes during migration.

---

## Task 1: Provider Interface & Types

**Files:**

- Create: `src/api/providers/types.ts`
- Create: `src/api/providers/cursor/types.ts`
- Modify: `src/types/opencode.ts`

**Interfaces:**

- Consumes: None (foundation task)
- Produces: `AgentProvider`, `ProviderConnectionConfig`, `CursorAgentConfig`

- [ ] **Step 1: Create provider-agnostic types**

```typescript
// src/api/providers/types.ts
import type { MessageWithParts } from "@/types/opencode";

export type AgentProviderType = "opencode" | "cursor";

export interface ProviderConnectionConfig {
  type: AgentProviderType;
}

export interface OpenCodeConnectionConfig extends ProviderConnectionConfig {
  type: "opencode";
  baseUrl: string;
  host: string;
  port: number;
  username: string;
  useAuth: boolean;
}

export interface CursorConnectionConfig extends ProviderConnectionConfig {
  type: "cursor";
  apiKey: string;
  repoUrl: string;
  branch: string;
  model: string;
}

export type AnyConnectionConfig =
  OpenCodeConnectionConfig | CursorConnectionConfig;

export interface HealthResult {
  healthy: boolean;
  version?: string;
}

export interface ProviderSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: "active" | "idle" | "running" | "error";
}

export interface AgentProvider {
  readonly type: AgentProviderType;
  readonly name: string;
  readonly supportsTerminal: boolean;
  readonly supportsFileBrowser: boolean;

  // Connection lifecycle
  connect(config: AnyConnectionConfig, password?: string): Promise<void>;
  disconnect(): Promise<void>;
  testConnection(
    config: AnyConnectionConfig,
    password?: string,
  ): Promise<HealthResult>;

  // Sessions
  listSessions(): Promise<ProviderSession[]>;
  createSession(title?: string): Promise<ProviderSession>;
  deleteSession(id: string): Promise<void>;
  selectSession(id: string): Promise<ProviderSession>;

  // Messages
  getMessages(sessionId: string): Promise<MessageWithParts[]>;
  sendPrompt(
    sessionId: string,
    text: string,
    attachments?: { path: string; name: string }[],
  ): Promise<void>;

  // Events
  subscribe(callback: (event: unknown) => void): () => void;

  // Project (OpenCode-specific, returns null for Cursor)
  getCurrentProject(): Promise<{ worktree?: string } | null>;
  listProjects(): Promise<{ worktree: string }[]>;
  selectProject(worktree: string): Promise<void>;

  // Commands (OpenCode-specific, returns [] for Cursor)
  listCommands(): Promise<{ name: string; description?: string }[]>;
  executeCommand(
    sessionId: string,
    command: string,
    args?: string,
  ): Promise<void>;
}
```

- [ ] **Step 2: Create Cursor API types**

```typescript
// src/api/providers/cursor/types.ts
export interface CursorAgent {
  id: string;
  name: string;
  status: "ACTIVE" | "ARCHIVED";
  env: { type: "cloud" };
  repos: { url: string; startingRef: string }[];
  branchName: string;
  autoGenerateBranch: boolean;
  autoCreatePR: boolean;
  url: string;
  createdAt: string;
  updatedAt: string;
  latestRunId: string | null;
}

export interface CursorRun {
  id: string;
  agentId: string;
  status: "CREATING" | "RUNNING" | "FINISHED" | "FAILED" | "CANCELLED";
  createdAt: string;
  updatedAt: string;
}

export interface CursorCreateAgentRequest {
  prompt: { text: string; images?: string[] };
  model?: { id: string; params?: { id: string; value: string }[] };
  repos?: { url: string; startingRef?: string }[];
  autoCreatePR?: boolean;
  skipReview?: boolean;
  envVars?: Record<string, string>;
}

export interface CursorCreateRunRequest {
  prompt: { text: string; images?: string[] };
}

export interface CursorListResponse<T> {
  items: T[];
  nextCursor: string | null;
}

export type CursorStreamEvent =
  | { type: "status"; payload: { runId: string; status: string } }
  | { type: "assistant"; payload: { text: string } }
  | { type: "thinking"; payload: { text: string } }
  | { type: "tool_call"; payload: Record<string, unknown> }
  | { type: "heartbeat" }
  | { type: "result"; payload: { runId: string; status: string } }
  | { type: "error"; payload: { code: string; message: string } };

export interface CursorModel {
  id: string;
  name: string;
}
```

- [ ] **Step 3: Update opencode types**

Add to `src/types/opencode.ts`:

```typescript
export type { AgentProviderType } from "@/api/providers/types";
```

- [ ] **Step 4: Commit**

```bash
git add src/api/providers/types.ts src/api/providers/cursor/types.ts src/types/opencode.ts
git commit -m "feat: add agent provider interface and Cursor API types"
```

---

## Task 2: Extract OpenCode Provider

**Files:**

- Create: `src/api/providers/opencode/client.ts`
- Create: `src/api/providers/opencode/event-bus.ts`
- Create: `src/api/providers/opencode/message-stream.ts`
- Create: `src/api/providers/opencode/hooks.ts`
- Create: `src/api/providers/opencode/provider.ts`
- Modify: `src/api/client.ts` (thin re-export)
- Modify: `src/api/hooks.ts` (thin re-export)

**Interfaces:**

- Consumes: `AgentProvider` interface from Task 1
- Produces: `OpenCodeProvider` instance, re-export compatibility

- [ ] **Step 1: Create OpenCode client wrapper**

```typescript
// src/api/providers/opencode/client.ts
import type { OpencodeClient, Session } from "@opencode-ai/sdk/client";
import { createOpencodeClient } from "@opencode-ai/sdk/client";
import type {
  OpenCodeConnectionConfig,
  HealthResult,
} from "@/api/providers/types";

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

export function parseTarget(input: string) {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Enter a host or URL.");
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  const url = new URL(withScheme);
  const port = url.port
    ? Number(url.port)
    : url.protocol === "https:"
      ? 443
      : DEFAULT_PORT;
  if (Number.isNaN(port)) throw new Error("Invalid port in target URL.");
  return {
    baseUrl: `${url.protocol}//${url.hostname}:${port}`,
    host: url.hostname,
    port,
  };
}

export function buildConnectionConfig(
  target: string,
  options?: { username?: string; useAuth?: boolean },
): OpenCodeConnectionConfig {
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

export function getClientCacheKey(config: OpenCodeConnectionConfig): string {
  return `${config.baseUrl}:${config.username}:${config.useAuth}`;
}

export function createAuthenticatedClient(
  config: OpenCodeConnectionConfig,
  password?: string,
): OpencodeClient {
  const cacheKey = `${getClientCacheKey(config)}:${password ?? ""}`;
  const cached = clientCache.get(cacheKey);
  if (cached) return cached;

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

export function clearClientCache(config?: OpenCodeConnectionConfig): void {
  if (!config) {
    clientCache.clear();
    return;
  }
  const prefix = getClientCacheKey(config);
  for (const key of clientCache.keys()) {
    if (key.startsWith(prefix)) clientCache.delete(key);
  }
}

export async function testConnection(
  config: OpenCodeConnectionConfig,
  password?: string,
): Promise<HealthResult> {
  const client = createAuthenticatedClient(config, password);
  const configResult = await client.config.get();
  return { healthy: Boolean(configResult.data), version: undefined };
}

export async function ensureSession(
  client: OpencodeClient,
  preferredSessionId?: string,
  directory?: string | null,
): Promise<Session> {
  const dirQuery = directory ? { query: { directory } } : {};
  if (preferredSessionId) {
    const preferred = await client.session.get({
      path: { id: preferredSessionId },
      ...dirQuery,
    });
    if (preferred.data) return preferred.data;
  }
  const sessions = await client.session.list(dirQuery);
  const existing = sessions.data?.[0];
  if (existing) return existing;
  const created = await client.session.create({
    ...dirQuery,
    body: { title: "Desk Escape" },
  });
  if (!created.data) throw new Error("Failed to create an OpenCode session.");
  return created.data;
}

export async function fetchCurrentProject(
  client: OpencodeClient,
  directory?: string | null,
) {
  const result = await client.project.current(
    directory ? { query: { directory } } : {},
  );
  return result.data ?? null;
}

export async function fetchProjectList(client: OpencodeClient) {
  const result = await client.project.list();
  return result.data ?? [];
}

export function getWorktreeName(worktree?: string | null): string {
  if (!worktree) return "No workspace";
  const segments = worktree.replace(/\\/g, "/").split("/");
  return segments[segments.length - 1] || worktree;
}
```

- [ ] **Step 2: Create OpenCode event bus**

Copy `src/api/event-bus.ts` to `src/api/providers/opencode/event-bus.ts` with no changes (it's already self-contained).

- [ ] **Step 3: Create OpenCode message stream**

Copy `src/api/message-stream.ts` to `src/api/providers/opencode/message-stream.ts` with no changes.

- [ ] **Step 4: Create OpenCode hooks**

```typescript
// src/api/providers/opencode/hooks.ts
// Re-export existing hooks with provider-scoped imports
export {
  sessionMessagesKey,
  sessionsKey,
  projectsKey,
  commandsKey,
  configKey,
  useSessions,
  useProjects,
  useCurrentProject,
  useCommands,
  useOpenCodeConfig,
  useUpdateConfig,
  useSessionMessages,
  useFileList,
  useFileStatus,
  useFilePatch,
  useSendPrompt,
  useExecuteCommand,
  useSessionMessageStream,
} from "@/api/hooks";
```

- [ ] **Step 5: Create OpenCode provider**

```typescript
// src/api/providers/opencode/provider.ts
import type { OpencodeClient, Session } from "@opencode-ai/sdk/client";
import type {
  AgentProvider,
  OpenCodeConnectionConfig,
  AnyConnectionConfig,
  HealthResult,
  ProviderSession,
} from "@/api/providers/types";
import type { MessageWithParts } from "@/types/opencode";
import {
  createAuthenticatedClient,
  clearClientCache,
  testConnection as testOpenCodeConnection,
  ensureSession,
  fetchCurrentProject,
  fetchProjectList,
} from "./client";
import { EventBus } from "./event-bus";

export class OpenCodeProvider implements AgentProvider {
  readonly type = "opencode" as const;
  readonly name = "OpenCode";
  readonly supportsTerminal = true;
  readonly supportsFileBrowser = true;

  private client: OpencodeClient | null = null;
  private config: OpenCodeConnectionConfig | null = null;
  private eventBus = new EventBus();
  private password: string | undefined;

  get currentClient(): OpencodeClient | null {
    return this.client;
  }

  async connect(config: AnyConnectionConfig, password?: string): Promise<void> {
    if (config.type !== "opencode")
      throw new Error("Invalid config type for OpenCode provider");
    this.config = config;
    this.password = password;
    this.client = createAuthenticatedClient(config, password);
    await this.eventBus.start(this.client);
  }

  async disconnect(): Promise<void> {
    this.eventBus.stop();
    if (this.config) clearClientCache(this.config);
    this.client = null;
    this.config = null;
  }

  async testConnection(
    config: AnyConnectionConfig,
    password?: string,
  ): Promise<HealthResult> {
    if (config.type !== "opencode") throw new Error("Invalid config type");
    return testOpenCodeConnection(config, password);
  }

  async listSessions(): Promise<ProviderSession[]> {
    if (!this.client) throw new Error("Not connected");
    const result = await this.client.session.list();
    return (result.data ?? []).map((s: Session) => ({
      id: s.id,
      title: s.title ?? "Untitled",
      createdAt: s.createdAt ?? "",
      updatedAt: s.updatedAt ?? "",
      status: "active" as const,
    }));
  }

  async createSession(title?: string): Promise<ProviderSession> {
    if (!this.client) throw new Error("Not connected");
    const result = await this.client.session.create({
      body: { title: title ?? "Desk Escape" },
    });
    if (!result.data) throw new Error("Failed to create session");
    const s = result.data;
    return {
      id: s.id,
      title: s.title ?? "Untitled",
      createdAt: s.createdAt ?? "",
      updatedAt: s.updatedAt ?? "",
      status: "active",
    };
  }

  async deleteSession(id: string): Promise<void> {
    if (!this.client) throw new Error("Not connected");
    await this.client.session.delete({ path: { id } });
  }

  async selectSession(id: string): Promise<ProviderSession> {
    if (!this.client) throw new Error("Not connected");
    const result = await this.client.session.get({ path: { id } });
    if (!result.data) throw new Error("Session not found");
    const s = result.data;
    return {
      id: s.id,
      title: s.title ?? "Untitled",
      createdAt: s.createdAt ?? "",
      updatedAt: s.updatedAt ?? "",
      status: "active",
    };
  }

  async getMessages(sessionId: string): Promise<MessageWithParts[]> {
    if (!this.client) throw new Error("Not connected");
    const result = await this.client.session.messages({
      path: { id: sessionId },
    });
    return (result.data ?? []) as MessageWithParts[];
  }

  async sendPrompt(
    sessionId: string,
    text: string,
    attachments?: { path: string; name: string }[],
  ): Promise<void> {
    if (!this.client) throw new Error("Not connected");
    const attachmentParts = (attachments ?? []).map((a) => ({
      type: "text" as const,
      text: `Context attachment: ${a.path}`,
    }));
    await this.client.session.prompt({
      path: { id: sessionId },
      body: { parts: [...attachmentParts, { type: "text", text }] },
    });
  }

  subscribe(callback: (event: unknown) => void): () => void {
    return this.eventBus.onEvent(callback);
  }

  async getCurrentProject(): Promise<{ worktree?: string } | null> {
    if (!this.client) return null;
    return fetchCurrentProject(this.client);
  }

  async listProjects(): Promise<{ worktree: string }[]> {
    if (!this.client) return [];
    return fetchProjectList(this.client);
  }

  async selectProject(_worktree: string): Promise<void> {
    // OpenCode project switching is handled via directory query params
  }

  async listCommands(): Promise<{ name: string; description?: string }[]> {
    if (!this.client) return [];
    const result = await this.client.command.list();
    return (result.data ?? []).map((c) => ({
      name: c.name,
      description: c.description,
    }));
  }

  async executeCommand(
    sessionId: string,
    command: string,
    args?: string,
  ): Promise<void> {
    if (!this.client) throw new Error("Not connected");
    await this.client.session.command({
      path: { id: sessionId },
      body: { command, arguments: args ?? "" },
    });
  }
}

// Singleton for the provider
export function createOpenCodeProvider(): OpenCodeProvider {
  return new OpenCodeProvider();
}
```

- [ ] **Step 6: Update old files to re-export**

Update `src/api/client.ts` to re-export from the OpenCode provider:

```typescript
// src/api/client.ts - replace contents with re-exports
export {
  buildConnectionConfig,
  configToTargetUrl,
  createAuthHeader,
  createAuthenticatedClient,
  clearClientCache,
  ensureSession,
  fetchCurrentProject,
  fetchProjectList,
  getWorktreeName,
  parseTarget,
  testConnection,
} from "@/api/providers/opencode/client";
```

Update `src/api/hooks.ts` to re-export:

```typescript
// src/api/hooks.ts - replace contents with re-exports
export {
  sessionMessagesKey,
  sessionsKey,
  projectsKey,
  commandsKey,
  configKey,
  useSessions,
  useProjects,
  useCurrentProject,
  useCommands,
  useOpenCodeConfig,
  useUpdateConfig,
  useSessionMessages,
  useFileList,
  useFileStatus,
  useFilePatch,
  useSendPrompt,
  useExecuteCommand,
  useSessionMessageStream,
} from "@/api/providers/opencode/hooks";
```

- [ ] **Step 7: Verify existing functionality**

Run: `bun run typecheck`
Expected: No new type errors (re-exports maintain compatibility)

- [ ] **Step 8: Commit**

```bash
git add src/api/providers/opencode/ src/api/client.ts src/api/hooks.ts
git commit -m "refactor: extract OpenCode provider behind AgentProvider interface"
```

---

## Task 3: Cursor Cloud Agents API Client

**Files:**

- Create: `src/api/providers/cursor/client.ts`

**Interfaces:**

- Consumes: Cursor API types from Task 1
- Produces: `CursorApiClient` class

- [ ] **Step 1: Create the Cursor API client**

```typescript
// src/api/providers/cursor/client.ts
import type {
  CursorAgent,
  CursorCreateAgentRequest,
  CursorCreateRunRequest,
  CursorListResponse,
  CursorModel,
  CursorRun,
} from "./types";

const BASE_URL = "https://api.cursor.com";

export class CursorApiClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private get authHeader(): string {
    return "Basic " + btoa(`${this.apiKey}:`);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${BASE_URL}${path}`;
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      "Content-Type": "application/json",
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`Cursor API error ${response.status}: ${errorBody}`);
    }

    return response.json() as Promise<T>;
  }

  // Agents
  async listAgents(cursor?: string): Promise<CursorListResponse<CursorAgent>> {
    const params = cursor ? `?cursor=${cursor}` : "";
    return this.request("GET", `/v1/agents${params}`);
  }

  async getAgent(id: string): Promise<CursorAgent> {
    return this.request("GET", `/v1/agents/${id}`);
  }

  async createAgent(
    request: CursorCreateAgentRequest,
  ): Promise<{ agent: CursorAgent; run: CursorRun }> {
    return this.request("POST", "/v1/agents", request);
  }

  async archiveAgent(id: string): Promise<void> {
    await this.request("POST", `/v1/agents/${id}/archive`);
  }

  async unarchiveAgent(id: string): Promise<void> {
    await this.request("POST", `/v1/agents/${id}/unarchive`);
  }

  async deleteAgent(id: string): Promise<void> {
    await this.request("DELETE", `/v1/agents/${id}`);
  }

  // Runs
  async listRuns(
    agentId: string,
    limit?: number,
  ): Promise<CursorListResponse<CursorRun>> {
    const params = limit ? `?limit=${limit}` : "";
    return this.request("GET", `/v1/agents/${agentId}/runs${params}`);
  }

  async getRun(agentId: string, runId: string): Promise<CursorRun> {
    return this.request("GET", `/v1/agents/${agentId}/runs/${runId}`);
  }

  async createRun(
    agentId: string,
    request: CursorCreateRunRequest,
  ): Promise<{ run: CursorRun }> {
    return this.request("POST", `/v1/agents/${agentId}/runs`, request);
  }

  async cancelRun(agentId: string, runId: string): Promise<void> {
    await this.request("POST", `/v1/agents/${agentId}/runs/${runId}/cancel`);
  }

  // Stream (SSE) - returns a ReadableStream of events
  async streamRun(
    agentId: string,
    runId: string,
    signal?: AbortSignal,
  ): Promise<ReadableStream<string>> {
    const url = `${BASE_URL}/v1/agents/${agentId}/runs/${runId}/stream`;
    const response = await fetch(url, {
      headers: { Authorization: this.authHeader },
      signal,
    });

    if (!response.ok) {
      throw new Error(`Cursor stream error ${response.status}`);
    }

    // The response body is an SSE stream
    return response.body!.pipeThrough(new TextDecoderStream());
  }

  // Models
  async listModels(): Promise<CursorListResponse<CursorModel>> {
    return this.request("GET", "/v1/models");
  }

  // Auth check
  async getMe(): Promise<{
    apiKeyName: string;
    userEmail: string;
    createdAt: string;
  }> {
    return this.request("GET", "/v1/me");
  }

  // Health check
  async testConnection(): Promise<{ healthy: boolean; email?: string }> {
    try {
      const me = await this.getMe();
      return { healthy: true, email: me.userEmail };
    } catch {
      return { healthy: false };
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/api/providers/cursor/client.ts
git commit -m "feat: add Cursor Cloud Agents API client"
```

---

## Task 4: Cursor Event Bus & Message Stream

**Files:**

- Create: `src/api/providers/cursor/event-bus.ts`
- Create: `src/api/providers/cursor/message-stream.ts`

**Interfaces:**

- Consumes: `CursorApiClient` from Task 3, `CursorStreamEvent` types
- Produces: Event subscription, `applyCursorStreamEvent()`, `isCursorAgentBusyEvent()`

- [ ] **Step 1: Create Cursor event bus**

```typescript
// src/api/providers/cursor/event-bus.ts
import { CursorApiClient } from "./client";
import type { CursorStreamEvent } from "./types";

type EventCallback = (event: CursorStreamEvent) => void;

export class CursorEventBus {
  private abortController: AbortController | null = null;
  private listeners: Set<EventCallback> = new Set();
  private active = false;
  private reader: ReadableStreamDefaultReader<string> | null = null;

  onEvent(callback: EventCallback): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  async start(
    client: CursorApiClient,
    agentId: string,
    runId: string,
  ): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.abortController = new AbortController();

    try {
      const stream = await client.streamRun(
        agentId,
        runId,
        this.abortController.signal,
      );
      this.reader = stream.getReader();

      let buffer = "";
      while (this.active) {
        const { done, value } = await this.reader.read();
        if (done) break;

        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === "[DONE]") continue;

          try {
            const event = JSON.parse(jsonStr) as CursorStreamEvent;
            for (const listener of this.listeners) {
              listener(event);
            }
          } catch {
            // Skip malformed events
          }
        }
      }
    } catch {
      // SSE may fail on network issues
    } finally {
      this.active = false;
      this.reader = null;
    }
  }

  stop(): void {
    this.active = false;
    this.abortController?.abort();
    this.abortController = null;
    this.reader?.cancel().catch(() => {});
    this.reader = null;
  }

  get isRunning(): boolean {
    return this.active;
  }
}
```

- [ ] **Step 2: Create Cursor message stream**

```typescript
// src/api/providers/cursor/message-stream.ts
import type { MessageWithParts } from "@/types/opencode";
import type { CursorStreamEvent } from "./types";

// Generate a simple unique ID for Cursor messages/runs
let idCounter = 0;
function generateId(): string {
  return `cursor-${Date.now()}-${++idCounter}`;
}

// Map Cursor stream events to the existing MessageWithParts format
export function applyCursorStreamEvent(
  messages: MessageWithParts[],
  event: CursorStreamEvent,
  currentRunId: string,
): MessageWithParts[] | null {
  switch (event.type) {
    case "assistant": {
      // Find or create the assistant message for this run
      const assistantMsg = messages.find(
        (m) => m.info.role === "assistant" && m.info.sessionID === currentRunId,
      );

      if (assistantMsg) {
        // Append text to existing text part
        const textPart = assistantMsg.parts.find((p) => p.type === "text");
        if (textPart && textPart.type === "text") {
          return messages.map((m) =>
            m.info.id === assistantMsg.id
              ? {
                  ...m,
                  parts: m.parts.map((p) =>
                    p.id === textPart.id
                      ? {
                          ...p,
                          text:
                            p.type === "text" ? p.text + event.payload.text : p,
                        }
                      : p,
                  ),
                }
              : m,
          );
        }
      }

      // Create new assistant message
      const msgId = generateId();
      const partId = generateId();
      return [
        ...messages,
        {
          info: {
            id: msgId,
            role: "assistant",
            sessionID: currentRunId,
            createdAt: new Date().toISOString(),
          } as MessageWithParts["info"],
          parts: [
            {
              id: partId,
              type: "text",
              text: event.payload.text,
            } as MessageWithParts["parts"][number],
          ],
        },
      ];
    }

    case "thinking": {
      // Find assistant message and add thinking part
      const assistantMsg = messages.find(
        (m) => m.info.role === "assistant" && m.info.sessionID === currentRunId,
      );

      if (assistantMsg) {
        const thinkingPart = assistantMsg.parts.find(
          (p) => p.type === "thinking",
        );
        if (thinkingPart && thinkingPart.type === "thinking") {
          return messages.map((m) =>
            m.info.id === assistantMsg.id
              ? {
                  ...m,
                  parts: m.parts.map((p) =>
                    p.id === thinkingPart.id
                      ? {
                          ...p,
                          content:
                            (p.type === "thinking" ? p.content : "") +
                            event.payload.text,
                        }
                      : p,
                  ),
                }
              : m,
          );
        }

        // Add new thinking part
        return messages.map((m) =>
          m.info.id === assistantMsg.id
            ? {
                ...m,
                parts: [
                  ...m.parts,
                  {
                    id: generateId(),
                    type: "thinking",
                    content: event.payload.text,
                  } as MessageWithParts["parts"][number],
                ],
              }
            : m,
        );
      }
      return null;
    }

    case "tool_call": {
      // Add tool call as a tool part
      const assistantMsg = messages.find(
        (m) => m.info.role === "assistant" && m.info.sessionID === currentRunId,
      );

      if (assistantMsg) {
        const toolPart = {
          id: generateId(),
          type: "tool" as const,
          tool: {
            name: (event.payload as Record<string, unknown>).name ?? "unknown",
            state: {
              status: "completed" as const,
              input: (event.payload as Record<string, unknown>).input,
              output: (event.payload as Record<string, unknown>).output,
            },
          },
        } as MessageWithParts["parts"][number];

        return messages.map((m) =>
          m.info.id === assistantMsg.id
            ? { ...m, parts: [...m.parts, toolPart] }
            : m,
        );
      }
      return null;
    }

    case "status": {
      // Status events don't produce messages, but can signal agent state
      return null;
    }

    case "result": {
      // Terminal event - run finished
      return null;
    }

    case "error": {
      // Add error as a system message
      const errorId = generateId();
      return [
        ...messages,
        {
          info: {
            id: errorId,
            role: "system",
            sessionID: currentRunId,
            createdAt: new Date().toISOString(),
          } as MessageWithParts["info"],
          parts: [
            {
              id: generateId(),
              type: "text",
              text: `Error: ${event.payload.message}`,
            } as MessageWithParts["parts"][number],
          ],
        },
      ];
    }

    default:
      return null;
  }
}

export function isCursorAgentBusyEvent(
  event: CursorStreamEvent,
): boolean | null {
  if (event.type === "status") {
    return (
      event.payload.status === "RUNNING" || event.payload.status === "CREATING"
    );
  }
  if (event.type === "result") {
    return false;
  }
  return null;
}

export function shouldRefetchCursorMessages(event: CursorStreamEvent): boolean {
  return event.type === "result";
}
```

- [ ] **Step 3: Commit**

```bash
git add src/api/providers/cursor/event-bus.ts src/api/providers/cursor/message-stream.ts
git commit -m "feat: add Cursor event bus and message stream adapter"
```

---

## Task 5: Cursor Provider & Hooks

**Files:**

- Create: `src/api/providers/cursor/provider.ts`
- Create: `src/api/providers/cursor/hooks.ts`

**Interfaces:**

- Consumes: `CursorApiClient`, `CursorEventBus`, `applyCursorStreamEvent` from Tasks 3-4
- Produces: `CursorProvider` implementing `AgentProvider`, React Query hooks

- [ ] **Step 1: Create Cursor hooks**

```typescript
// src/api/providers/cursor/hooks.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { MessageWithParts } from "@/types/opencode";

// Query key factories
export const cursorSessionsKey = ["cursor", "sessions"] as const;
export const cursorMessagesKey = (agentId: string) =>
  ["cursor", "messages", agentId] as const;
export const cursorModelsKey = ["cursor", "models"] as const;

export function useCursorSessions(
  getProvider: () => import("./provider").CursorProvider | null,
) {
  return useQuery({
    queryKey: cursorSessionsKey,
    queryFn: async () => {
      const provider = getProvider();
      if (!provider) return [];
      return provider.listSessions();
    },
    staleTime: 30_000,
  });
}

export function useCursorMessages(
  getProvider: () => import("./provider").CursorProvider | null,
  agentId: string | null,
) {
  return useQuery({
    enabled: Boolean(agentId),
    queryKey: agentId
      ? cursorMessagesKey(agentId)
      : ["cursor", "messages", "none"],
    queryFn: async (): Promise<MessageWithParts[]> => {
      const provider = getProvider();
      if (!provider || !agentId) return [];
      return provider.getMessages(agentId);
    },
    staleTime: Infinity,
    refetchOnMount: "always",
  });
}

export function useCursorModels(
  getProvider: () => import("./provider").CursorProvider | null,
) {
  return useQuery({
    queryKey: cursorModelsKey,
    queryFn: async () => {
      const provider = getProvider();
      if (!provider) return [];
      return provider.getAvailableModels();
    },
    staleTime: 60_000,
  });
}

export function useCursorSendPrompt(
  getProvider: () => import("./provider").CursorProvider | null,
  agentId: string | null,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (text: string) => {
      const provider = getProvider();
      if (!provider || !agentId) throw new Error("No active agent");
      await provider.sendPrompt(agentId, text);
    },
    onSettled: async () => {
      if (agentId) {
        await queryClient.invalidateQueries({
          queryKey: cursorMessagesKey(agentId),
        });
      }
    },
  });
}
```

- [ ] **Step 2: Create Cursor provider**

```typescript
// src/api/providers/cursor/provider.ts
import type {
  AgentProvider,
  AnyConnectionConfig,
  CursorConnectionConfig,
  HealthResult,
  ProviderSession,
} from "@/api/providers/types";
import type { MessageWithParts } from "@/types/opencode";
import { CursorApiClient } from "./client";
import { CursorEventBus } from "./event-bus";
import {
  applyCursorStreamEvent,
  isCursorAgentBusyEvent,
} from "./message-stream";

export class CursorProvider implements AgentProvider {
  readonly type = "cursor" as const;
  readonly name = "Cursor";
  readonly supportsTerminal = false;
  readonly supportsFileBrowser = false;

  private client: CursorApiClient | null = null;
  private config: CursorConnectionConfig | null = null;
  private eventBus = new CursorEventBus();
  private currentAgentId: string | null = null;
  private currentRunId: string | null = null;
  private messages: Map<string, MessageWithParts[]> = new Map();
  private listeners: Set<(event: unknown) => void> = new Set();

  async connect(
    config: AnyConnectionConfig,
    _password?: string,
  ): Promise<void> {
    if (config.type !== "cursor")
      throw new Error("Invalid config type for Cursor provider");
    this.config = config;
    this.client = new CursorApiClient(config.apiKey);

    // Validate connection
    const health = await this.client.testConnection();
    if (!health.healthy) {
      throw new Error("Cursor API authentication failed. Check your API key.");
    }
  }

  async disconnect(): Promise<void> {
    this.eventBus.stop();
    this.client = null;
    this.config = null;
    this.currentAgentId = null;
    this.currentRunId = null;
    this.messages.clear();
  }

  async testConnection(
    config: AnyConnectionConfig,
    _password?: string,
  ): Promise<HealthResult> {
    if (config.type !== "cursor") throw new Error("Invalid config type");
    const client = new CursorApiClient(config.apiKey);
    return client.testConnection();
  }

  async listSessions(): Promise<ProviderSession[]> {
    if (!this.client) throw new Error("Not connected");
    const result = await this.client.listAgents();
    return result.items.map((agent) => ({
      id: agent.id,
      title: agent.name,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
      status: agent.status === "ACTIVE" ? "active" : "idle",
    }));
  }

  async createSession(title?: string): Promise<ProviderSession> {
    if (!this.client || !this.config) throw new Error("Not connected");

    const result = await this.client.createAgent({
      prompt: { text: title ?? "New agent session" },
      repos: [{ url: this.config.repoUrl, startingRef: this.config.branch }],
      model: this.config.model ? { id: this.config.model } : undefined,
    });

    this.currentAgentId = result.agent.id;
    this.currentRunId = result.run.id;

    return {
      id: result.agent.id,
      title: result.agent.name,
      createdAt: result.agent.createdAt,
      updatedAt: result.agent.updatedAt,
      status: "running",
    };
  }

  async deleteSession(id: string): Promise<void> {
    if (!this.client) throw new Error("Not connected");
    await this.client.archiveAgent(id);
    if (this.currentAgentId === id) {
      this.currentAgentId = null;
      this.currentRunId = null;
    }
  }

  async selectSession(id: string): Promise<ProviderSession> {
    if (!this.client) throw new Error("Not connected");
    const agent = await this.client.getAgent(id);
    this.currentAgentId = id;
    this.currentRunId = agent.latestRunId;

    return {
      id: agent.id,
      title: agent.name,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
      status: agent.status === "ACTIVE" ? "active" : "idle",
    };
  }

  async getMessages(sessionId: string): Promise<MessageWithParts[]> {
    return this.messages.get(sessionId) ?? [];
  }

  async sendPrompt(
    sessionId: string,
    text: string,
    _attachments?: { path: string; name: string }[],
  ): Promise<void> {
    if (!this.client) throw new Error("Not connected");

    // If no current run, create one
    if (!this.currentRunId || this.currentAgentId !== sessionId) {
      const result = await this.client.createRun(sessionId, {
        prompt: { text },
      });
      this.currentAgentId = sessionId;
      this.currentRunId = result.run.id;
    } else {
      // Create follow-up run
      const result = await this.client.createRun(sessionId, {
        prompt: { text },
      });
      this.currentRunId = result.run.id;
    }

    // Start streaming
    this.startStreaming(sessionId, this.currentRunId);
  }

  private startStreaming(agentId: string, runId: string): void {
    this.eventBus.stop();

    const unsubscribe = this.eventBus.onEvent((event) => {
      const currentMessages = this.messages.get(agentId) ?? [];
      const updated = applyCursorStreamEvent(currentMessages, event, runId);
      if (updated) {
        this.messages.set(agentId, updated);
      }

      // Notify listeners
      for (const listener of this.listeners) {
        listener(event);
      }
    });

    // Store unsubscribe for cleanup
    void this.eventBus.start(this.client!, agentId, runId);
  }

  subscribe(callback: (event: unknown) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  async getCurrentProject(): Promise<{ worktree?: string } | null> {
    // Cursor cloud agents don't have local workspaces
    if (this.config) {
      return { worktree: this.config.repoUrl };
    }
    return null;
  }

  async listProjects(): Promise<{ worktree: string }[]> {
    if (this.config) {
      return [{ worktree: this.config.repoUrl }];
    }
    return [];
  }

  async selectProject(_worktree: string): Promise<void> {
    // Cursor agents are tied to repos set at creation time
  }

  async listCommands(): Promise<{ name: string; description?: string }[]> {
    // Cursor doesn't have slash commands in the API
    return [];
  }

  async executeCommand(
    _sessionId: string,
    _command: string,
    _args?: string,
  ): Promise<void> {
    // No-op for Cursor
  }

  // Cursor-specific methods
  async getAvailableModels(): Promise<{ id: string; name: string }[]> {
    if (!this.client) return [];
    const result = await this.client.listModels();
    return result.items;
  }

  getCurrentAgentId(): string | null {
    return this.currentAgentId;
  }

  getCurrentRunId(): string | null {
    return this.currentRunId;
  }
}

export function createCursorProvider(): CursorProvider {
  return new CursorProvider();
}
```

- [ ] **Step 3: Commit**

```bash
git add src/api/providers/cursor/provider.ts src/api/providers/cursor/hooks.ts
git commit -m "feat: add Cursor provider implementing AgentProvider interface"
```

---

## Task 6: Provider Picker & Cursor Connection Screen

**Files:**

- Create: `src/screens/ProviderPickerScreen.tsx`
- Create: `src/screens/CursorConnectionScreen.tsx`
- Modify: `src/navigation/RootNavigator.tsx`

**Interfaces:**

- Consumes: `AgentProviderType` from Task 1
- Produces: Two new screens, updated navigation

- [ ] **Step 1: Create Provider Picker screen**

```typescript
// src/screens/ProviderPickerScreen.tsx
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Bot, Terminal } from "lucide-react-native";
import { useTheme } from "@/context/ThemeContext";
import type { RootStackParamList } from "@/navigation/RootNavigator";

type Navigation = NativeStackNavigationProp<RootStackParamList, "ProviderPicker">;

export function ProviderPickerScreen() {
  const navigation = useNavigation<Navigation>();
  const { colors, spacing, typography } = useTheme();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: colors.background,
          justifyContent: "center",
          alignItems: "center",
          padding: spacing.xl,
        },
        title: {
          color: colors.text,
          fontSize: typography.title,
          fontWeight: "700",
          marginBottom: spacing.xs,
        },
        subtitle: {
          color: colors.textMuted,
          fontSize: typography.body,
          marginBottom: spacing.xl,
          textAlign: "center",
        },
        options: {
          gap: spacing.md,
          width: "100%",
          maxWidth: 400,
        },
        option: {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: 16,
          borderWidth: 1,
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.md,
          padding: spacing.lg,
        },
        optionIcon: {
          width: 48,
          height: 48,
          borderRadius: 12,
          backgroundColor: colors.surfaceElevated,
          alignItems: "center",
          justifyContent: "center",
        },
        optionText: {
          flex: 1,
        },
        optionTitle: {
          color: colors.text,
          fontSize: typography.body,
          fontWeight: "600",
        },
        optionDescription: {
          color: colors.textMuted,
          fontSize: typography.caption,
          marginTop: 4,
        },
      }),
    [colors, spacing, typography],
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Desk Escape</Text>
      <Text style={styles.subtitle}>Choose your AI coding agent</Text>

      <View style={styles.options}>
        <Pressable
          onPress={() => navigation.navigate("Connection")}
          style={styles.option}
        >
          <View style={styles.optionIcon}>
            <Terminal color={colors.accent} size={24} />
          </View>
          <View style={styles.optionText}>
            <Text style={styles.optionTitle}>OpenCode</Text>
            <Text style={styles.optionDescription}>
              Connect to a self-hosted OpenCode server
            </Text>
          </View>
        </Pressable>

        <Pressable
          onPress={() => navigation.navigate("CursorConnection")}
          style={styles.option}
        >
          <View style={styles.optionIcon}>
            <Bot color={colors.accent} size={24} />
          </View>
          <View style={styles.optionText}>
            <Text style={styles.optionTitle}>Cursor</Text>
            <Text style={styles.optionDescription}>
              Use Cursor Cloud Agents with your API key
            </Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}
```

- [ ] **Step 2: Create Cursor Connection screen**

```typescript
// src/screens/CursorConnectionScreen.tsx
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Check, ChevronLeft, Lock, Wifi, X } from "lucide-react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { buildCursorConnectionConfig } from "@/api/providers/cursor/client";
import { useConnection } from "@/context/ConnectionContext";
import { useTheme } from "@/context/ThemeContext";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import type { CursorConnectionConfig, TestConnectionStatus } from "@/types/opencode";

type Navigation = NativeStackNavigationProp<RootStackParamList, "CursorConnection">;

const CURSOR_CONFIG_KEY = "@desk-escape/cursor-config";

export function CursorConnectionScreen() {
  const navigation = useNavigation<Navigation>();
  const { colors, spacing, typography } = useTheme();
  const { connect, testServerConnection, errorMessage } = useConnection();

  const [apiKey, setApiKey] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [model, setModel] = useState("composer-2");
  const [testStatus, setTestStatus] = useState<TestConnectionStatus>("idle");
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  // Load saved config
  useEffect(() => {
    void (async () => {
      const stored = await AsyncStorage.getItem(CURSOR_CONFIG_KEY);
      if (stored) {
        const config = JSON.parse(stored) as CursorConnectionConfig;
        setApiKey(config.apiKey);
        setRepoUrl(config.repoUrl);
        setBranch(config.branch);
        setModel(config.model);
      }
    })();
  }, []);

  const buildConfig = useCallback((): CursorConnectionConfig => {
    return {
      type: "cursor",
      apiKey: apiKey.trim(),
      repoUrl: repoUrl.trim(),
      branch: branch.trim() || "main",
      model: model.trim() || "composer-2",
    };
  }, [apiKey, repoUrl, branch, model]);

  const handleTest = useCallback(async () => {
    setTestStatus("testing");
    setTestMessage(null);

    try {
      const config = buildConfig();
      if (!config.apiKey) {
        setTestStatus("error");
        setTestMessage("API key is required.");
        return;
      }
      const result = await testServerConnection(config);
      if (result.healthy) {
        setTestStatus("success");
        setTestMessage("Cursor API connection successful.");
      } else {
        setTestStatus("error");
        setTestMessage("Authentication failed. Check your API key.");
      }
    } catch (error) {
      setTestStatus("error");
      setTestMessage(error instanceof Error ? error.message : "Connection test failed.");
    }
  }, [buildConfig, testServerConnection]);

  const handleConnect = useCallback(async () => {
    setIsConnecting(true);
    try {
      const config = buildConfig();
      await AsyncStorage.setItem(CURSOR_CONFIG_KEY, JSON.stringify(config));
      await connect(config);
      navigation.replace("Workspace");
    } catch {
      // Error handled by context
    } finally {
      setIsConnecting(false);
    }
  }, [buildConfig, connect, navigation]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: colors.background,
          padding: spacing.lg,
        },
        header: {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
          marginBottom: spacing.lg,
        },
        backButton: {
          padding: spacing.xs,
        },
        title: {
          color: colors.text,
          fontSize: typography.title,
          fontWeight: "700",
        },
        subtitle: {
          color: colors.textMuted,
          fontSize: typography.body,
          marginBottom: spacing.lg,
        },
        label: {
          color: colors.textMuted,
          fontSize: typography.caption,
          marginBottom: spacing.xs,
        },
        input: {
          backgroundColor: colors.inputBackground,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 12,
          color: colors.text,
          fontSize: typography.body,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          marginBottom: spacing.md,
        },
        statusCard: {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: 12,
          borderWidth: 1,
          marginBottom: spacing.md,
          padding: spacing.md,
        },
        statusText: {
          color: colors.text,
          fontSize: typography.body,
        },
        button: {
          alignItems: "center",
          backgroundColor: colors.accent,
          borderRadius: 12,
          flexDirection: "row",
          gap: spacing.sm,
          justifyContent: "center",
          paddingVertical: spacing.md,
        },
        buttonSecondary: {
          backgroundColor: colors.surfaceElevated,
          borderColor: colors.border,
          borderWidth: 1,
          marginTop: spacing.sm,
        },
        buttonText: {
          color: "#04111A",
          fontSize: typography.body,
          fontWeight: "600",
        },
        buttonSecondaryText: {
          color: colors.text,
        },
        errorText: {
          color: colors.danger,
          fontSize: typography.caption,
          marginBottom: spacing.md,
        },
      }),
    [colors, spacing, typography],
  );

  const statusIcon = useMemo(() => {
    switch (testStatus) {
      case "testing":
        return <ActivityIndicator color={colors.accent} />;
      case "success":
        return <Check color={colors.success} size={18} />;
      case "error":
        return <X color={colors.danger} size={18} />;
      default:
        return <Wifi color={colors.textMuted} size={18} />;
    }
  }, [colors, testStatus]);

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <ChevronLeft color={colors.text} size={24} />
        </Pressable>
        <Text style={styles.title}>Cursor</Text>
      </View>

      <Text style={styles.subtitle}>
        Connect to Cursor Cloud Agents with your API key.
      </Text>

      <Text style={styles.label}>API Key</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setApiKey}
        placeholder="Get from cursor.com/dashboard/integrations"
        placeholderTextColor={colors.textMuted}
        secureTextEntry
        style={styles.input}
        value={apiKey}
      />

      <Text style={styles.label}>Repository URL</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        onChangeText={setRepoUrl}
        placeholder="https://github.com/owner/repo"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        value={repoUrl}
      />

      <Text style={styles.label}>Branch</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setBranch}
        placeholder="main"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        value={branch}
      />

      <Text style={styles.label}>Model</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setModel}
        placeholder="composer-2"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        value={model}
      />

      <View style={styles.statusCard}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {statusIcon}
          <Text style={styles.statusText}>
            {testMessage ?? "Run a connection test before connecting."}
          </Text>
        </View>
      </View>

      {errorMessage ? (
        <Text style={styles.errorText}>{errorMessage}</Text>
      ) : null}

      <Pressable onPress={() => void handleTest()} style={styles.button}>
        <Wifi color="#04111A" size={18} />
        <Text style={styles.buttonText}>Test Connection</Text>
      </Pressable>

      <Pressable
        disabled={isConnecting}
        onPress={() => void handleConnect()}
        style={[styles.button, styles.buttonSecondary]}
      >
        {isConnecting ? (
          <ActivityIndicator color={colors.text} />
        ) : (
          <Text style={[styles.buttonText, styles.buttonSecondaryText]}>
            Connect
          </Text>
        )}
      </Pressable>
    </ScrollView>
  );
}
```

- [ ] **Step 3: Update navigation**

```typescript
// src/navigation/RootNavigator.tsx
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ConnectionScreen } from "@/screens/ConnectionScreen";
import { CursorConnectionScreen } from "@/screens/CursorConnectionScreen";
import { PluginManagerScreen } from "@/screens/PluginManagerScreen";
import { ProviderPickerScreen } from "@/screens/ProviderPickerScreen";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { WorkspaceScreen } from "@/screens/WorkspaceScreen";

export type RootStackParamList = {
  ProviderPicker: undefined;
  Connection: undefined;
  CursorConnection: undefined;
  Workspace: undefined;
  Settings: undefined;
  Plugins: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="ProviderPicker"
      screenOptions={{
        headerShown: false,
        animation: "fade",
      }}
    >
      <Stack.Screen name="ProviderPicker" component={ProviderPickerScreen} />
      <Stack.Screen name="Connection" component={ConnectionScreen} />
      <Stack.Screen name="CursorConnection" component={CursorConnectionScreen} />
      <Stack.Screen name="Workspace" component={WorkspaceScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="Plugins" component={PluginManagerScreen} />
    </Stack.Navigator>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/screens/ProviderPickerScreen.tsx src/screens/CursorConnectionScreen.tsx src/navigation/RootNavigator.tsx
git commit -m "feat: add provider picker and Cursor connection screens"
```

---

## Task 7: Refactor ConnectionContext for Multi-Provider

**Files:**

- Modify: `src/context/ConnectionContext.tsx`

**Interfaces:**

- Consumes: `AgentProvider`, `AnyConnectionConfig` from Task 1, OpenCode/Cursor providers from Tasks 2,5
- Produces: Provider-agnostic `ConnectionContext`

- [ ] **Step 1: Refactor ConnectionContext**

The key changes:

1. Add `providerType: AgentProviderType` to context value
2. Store active `AgentProvider` instance
3. Route `connect()` to the correct provider based on config type
4. Expose `activeProvider` for components to check capabilities
5. Keep backward compatibility for OpenCode-specific features

Replace the `ConnectionProvider` implementation with a provider-agnostic version that delegates to the active `AgentProvider`. The full file is too large to include inline, but the key structural changes are:

- Add `import type { AgentProvider, AgentProviderType, AnyConnectionConfig } from "@/api/providers/types"`
- Add `import { OpenCodeProvider } from "@/api/providers/opencode/provider"`
- Add `import { CursorProvider } from "@/api/providers/cursor/provider"`
- Add state: `providerType: AgentProviderType`, `activeProvider: AgentProvider | null`
- Modify `connect()` to accept `AnyConnectionConfig` and instantiate the correct provider
- Modify all hook calls (`useSessions`, `useSendPrompt`, etc.) to delegate to `activeProvider`
- Add `activeProvider` to context value for capability checks

- [ ] **Step 2: Commit**

```bash
git add src/context/ConnectionContext.tsx
git commit -m "refactor: make ConnectionContext provider-agnostic"
```

---

## Task 8: Workspace UI Adaptations

**Files:**

- Modify: `src/screens/WorkspaceScreen.tsx`
- Modify: `src/components/PanelTabs.tsx`
- Modify: `src/components/AgentChat.tsx`

**Interfaces:**

- Consumes: `activeProvider` from ConnectionContext
- Produces: Conditional UI for Cursor (no terminal/files)

- [ ] **Step 1: Update WorkspaceScreen**

In `WorkspaceScreen.tsx`, add capability checks:

```typescript
const { activeProvider } = useConnection();
const supportsTerminal = activeProvider?.supportsTerminal ?? true;
const supportsFiles = activeProvider?.supportsFileBrowser ?? true;
```

- Conditionally render `TerminalPanel` and `FileDrawer` based on `supportsTerminal` and `supportsFiles`
- For Cursor, the workspace shows only the agent chat panel
- Update `PanelTabs` to only show available panels

- [ ] **Step 2: Update PanelTabs**

```typescript
interface PanelTabsProps {
  activePanel: WorkspacePanel;
  onPanelChange: (panel: WorkspacePanel) => void;
  supportsTerminal: boolean;
  supportsFiles: boolean;
}
```

Filter out "terminal" and "files" tabs when not supported.

- [ ] **Step 3: Update AgentChat**

In `AgentChat.tsx`, import from the provider-agnostic hooks. The `useSendPrompt` and `useSessionMessageStream` hooks should work with both providers through the refactored `ConnectionContext`.

- [ ] **Step 4: Commit**

```bash
git add src/screens/WorkspaceScreen.tsx src/components/PanelTabs.tsx src/components/AgentChat.tsx
git commit -m "feat: adapt workspace UI for Cursor (hide terminal/files)"
```

---

## Task 9: Type Exports & Integration

**Files:**

- Modify: `src/types/opencode.ts`
- Modify: `src/api/permissions.ts` (minor)

**Interfaces:**

- Consumes: All provider types
- Produces: Clean type exports

- [ ] **Step 1: Update type exports**

```typescript
// src/types/opencode.ts - add at bottom
export type {
  AgentProviderType,
  AnyConnectionConfig,
  CursorConnectionConfig,
  OpenCodeConnectionConfig,
} from "@/api/providers/types";
```

- [ ] **Step 2: Make permissions provider-agnostic**

The permission system is OpenCode-specific. For Cursor, permissions are handled by the Cursor platform itself (sandbox). Add a guard:

```typescript
// In PermissionContext.tsx
const { activeProvider } = useConnection();
// Only subscribe to permissions for OpenCode
useEffect(() => {
  if (activeProvider?.type !== "opencode") return;
  // ... existing permission logic
}, [activeProvider]);
```

- [ ] **Step 3: Commit**

```bash
git add src/types/opencode.ts src/context/PermissionContext.tsx
git commit -m "feat: make permissions provider-aware, export new types"
```

---

## Task 10: Verification & Testing

**Files:**

- None (verification only)

**Interfaces:**

- Consumes: All tasks above
- Produces: Verified working integration

- [ ] **Step 1: Run type check**

Run: `bun run typecheck`
Expected: No type errors

- [ ] **Step 2: Run linter**

Run: `bun run lint`
Expected: No lint errors

- [ ] **Step 3: Run full check**

Run: `bun run check`
Expected: All checks pass

- [ ] **Step 4: Manual verification**

1. Start the app: `bun run start`
2. Verify Provider Picker screen appears as initial screen
3. Tap "OpenCode" - verify existing connection flow works unchanged
4. Go back, tap "Cursor" - verify Cursor connection screen appears
5. Enter test API key and repo URL, verify test connection works
6. Connect to Cursor, verify workspace shows only agent chat (no terminal/files)
7. Send a message, verify streaming works
8. Disconnect, verify clean disconnection

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: Cursor Cloud Agents dual-backend support"
```

---

## Feature Gap Notes

| OpenCode Feature   | Cursor Equivalent                 | Status                    |
| ------------------ | --------------------------------- | ------------------------- |
| PTY Terminal       | Not available in Cloud Agents     | Hidden in Cursor mode     |
| File Browser       | Not available in Cloud Agents API | Hidden in Cursor mode     |
| Slash Commands     | Not supported                     | Command palette adapted   |
| Permissions        | Handled by Cursor sandbox         | Permission system skipped |
| Project Switching  | Tied to repo URL at creation      | Single repo per agent     |
| Offline Queue      | Can be implemented                | Future enhancement        |
| Reconnection       | SSE stream reconnection           | Built into event bus      |
| Biometric Lock     | Works unchanged                   | Provider-agnostic         |
| Themes             | Works unchanged                   | Provider-agnostic         |
| Session Management | Maps to Cursor agents             | Fully supported           |
| Message Streaming  | SSE via Cursor API                | Fully supported           |
| Tool Calls         | Parsed from stream events         | Fully supported           |
| Thinking Blocks    | Parsed from stream events         | Fully supported           |
