import type { OpenCodeClient } from "@opencode/client";

import type {
  AgentProvider,
  AnyConnectionConfig,
  HealthResult,
  OpenCodeConnectionConfig,
  ProviderSession,
} from "@/api/providers/types";
import type { ChatMessage } from "@/types/domain";
import {
  clearClientCache,
  createAuthenticatedClient,
  fetchCurrentProject,
  fetchProjectList,
  testConnection as testOpenCodeConnection,
} from "./client";
import { withLocation } from "@/api/opencode/location";
import { withOpenCodeErrors } from "@/api/opencode/errors";
import { toChatMessages, toFileEntry } from "@/api/opencode/adapter";
import { EventBus } from "./event-bus";

/** Shape both `session.list` and `session.get` results are reduced to. */
interface SessionSummary {
  id: string;
  title?: string;
  time: { created: number; updated: number };
}

function toProviderSession(session: SessionSummary): ProviderSession {
  return {
    id: session.id,
    title: session.title ?? "Untitled",
    createdAt: session.time?.created ? String(session.time.created) : "",
    updatedAt: session.time?.updated ? String(session.time.updated) : "",
    status: "active",
  };
}

export class OpenCodeProvider implements AgentProvider {
  readonly type = "opencode" as const;
  readonly name = "OpenCode";
  readonly supportsTerminal = true;
  readonly supportsFileBrowser = true;

  /** Directory used to scope location-scoped calls for this provider. */
  private directory: string | null = null;

  private _client: OpenCodeClient | null = null;
  private _config: OpenCodeConnectionConfig | null = null;
  private eventBus = new EventBus();
  private password: string | undefined;

  get currentClient(): OpenCodeClient | null {
    return this._client;
  }

  async connect(config: AnyConnectionConfig, password?: string): Promise<void> {
    if (config.type !== "opencode") {
      throw new Error("Invalid config type for OpenCode provider");
    }
    this._config = config;
    this.password = password;
    this._client = createAuthenticatedClient(config, password);
    await this.eventBus.start(this._client);
  }

  async disconnect(): Promise<void> {
    this.eventBus.stop();
    if (this._config) {
      clearClientCache(this._config);
    }
    this._client = null;
    this._config = null;
    this.password = undefined;
  }

  async testConnection(
    config: AnyConnectionConfig,
    password?: string,
  ): Promise<HealthResult> {
    if (config.type !== "opencode") {
      throw new Error("Invalid config type for OpenCode provider");
    }
    return testOpenCodeConnection(config, password);
  }

  private requireClient(): OpenCodeClient {
    if (!this._client) {
      throw new Error("Not connected");
    }
    return this._client;
  }

  async listSessions(): Promise<ProviderSession[]> {
    const client = this.requireClient();
    // `session.list` filters by a plain `directory` string, not a `location`
    // object, so it never takes the scope helper.
    const result = await withOpenCodeErrors(() =>
      client.session.list({
        ...(this.directory ? { directory: this.directory } : {}),
      }),
    );
    return result.data.map(toProviderSession);
  }

  async createSession(title?: string): Promise<ProviderSession> {
    const client = this.requireClient();
    // A session's scope is fixed at creation. Omitting `location` lands it in
    // the server's default directory, after which reads come back from the
    // wrong scope.
    const created = await withOpenCodeErrors(() =>
      client.session.create({
        title: title ?? "Desk Escape",
        ...(this.directory ? { location: { directory: this.directory } } : {}),
      }),
    );
    return toProviderSession(created);
  }

  async deleteSession(id: string): Promise<void> {
    const client = this.requireClient();
    await withOpenCodeErrors(() => client.session.remove({ sessionID: id }));
  }

  async selectSession(id: string): Promise<ProviderSession> {
    const client = this.requireClient();
    const session = await withOpenCodeErrors(() =>
      client.session.get({ sessionID: id }),
    );
    return toProviderSession(session);
  }

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    const client = this.requireClient();
    // V2 moved this to a top-level `message.list` namespace and returns the
    // messages nested (assistant content is inline, there is no parts array).
    const page = await withOpenCodeErrors(() =>
      client.message.list({ sessionID: sessionId, order: "asc" }),
    );
    return toChatMessages(page.data);
  }

  async sendPrompt(
    sessionId: string,
    text: string,
    attachments?: { path: string; name: string }[],
  ): Promise<void> {
    const client = this.requireClient();
    // Flat body in V2: a single `text` field, no `parts` array.
    const prefix = (attachments ?? [])
      .map((a) => `Context attachment: ${a.path}\n`)
      .join("");

    await withOpenCodeErrors(() =>
      client.session.prompt({
        sessionID: sessionId,
        text: prefix + text,
        delivery: "steer",
      }),
    );
  }

  subscribe(callback: (event: unknown) => void): () => void {
    return this.eventBus.onEvent(callback);
  }

  async getCurrentProject(): Promise<{ worktree?: string } | null> {
    if (!this._client) {
      return null;
    }
    // V2 removed `project.current()`; this resolves via `location.get()`.
    return fetchCurrentProject(this._client, this.directory);
  }

  async listProjects(): Promise<{ worktree: string }[]> {
    if (!this._client) {
      return [];
    }
    return fetchProjectList(this._client);
  }

  /**
   * Record the active directory.
   *
   * V2 removed the `directory` query parameter that V1 threaded through every
   * call, so switching projects is no longer a server round-trip. Instead the
   * directory is held locally and applied per call as `location[directory]`
   * (or as a plain `directory` for `session.list`). New sessions created
   * afterwards are created scoped to it.
   */
  async selectProject(worktree: string): Promise<void> {
    this.directory = worktree;
  }

  async listCommands(): Promise<{ name: string; description?: string }[]> {
    const client = this.requireClient();
    const result = await withOpenCodeErrors(() =>
      client.command.list(withLocation(this.directory)),
    );
    return result.data;
  }

  async executeCommand(
    sessionId: string,
    command: string,
    args?: string,
  ): Promise<void> {
    const client = this.requireClient();
    // V1 sent `{ command, arguments }`; V2 sends `{ name, text }`.
    await withOpenCodeErrors(() =>
      client.session.command({
        sessionID: sessionId,
        name: command,
        text: args ?? "",
        delivery: "steer",
      }),
    );
  }

  /** Directory listing, kept for the file browser. */
  async listFiles(path: string) {
    const client = this.requireClient();
    const result = await withOpenCodeErrors(() =>
      client.file.list({ ...withLocation(this.directory), path }),
    );
    return result.data.map(toFileEntry);
  }
}

export function createOpenCodeProvider(): OpenCodeProvider {
  return new OpenCodeProvider();
}
