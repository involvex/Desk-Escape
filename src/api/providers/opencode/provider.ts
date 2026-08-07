import type { OpencodeClient, Session } from "@opencode-ai/sdk/client";
import type {
  AgentProvider,
  HealthResult,
  OpenCodeConnectionConfig,
  ProviderSession,
  AnyConnectionConfig,
} from "@/api/providers/types";
import type { MessageWithParts } from "@/types/opencode";
import {
  clearClientCache,
  createAuthenticatedClient,
  fetchCurrentProject,
  fetchProjectList,
  testConnection as testOpenCodeConnection,
} from "./client";
import { EventBus } from "./event-bus";

export class OpenCodeProvider implements AgentProvider {
  readonly type = "opencode" as const;
  readonly name = "OpenCode";
  readonly supportsTerminal = true;
  readonly supportsFileBrowser = true;

  private _client: OpencodeClient | null = null;
  private _config: OpenCodeConnectionConfig | null = null;
  private eventBus = new EventBus();
  private password: string | undefined;

  get currentClient(): OpencodeClient | null {
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

  async listSessions(): Promise<ProviderSession[]> {
    if (!this._client) {
      throw new Error("Not connected");
    }
    const result = await this._client.session.list();
    return (result.data ?? []).map((s: Session) => ({
      id: s.id,
      title: s.title ?? "Untitled",
      createdAt: s.time?.created ? String(s.time.created) : "",
      updatedAt: s.time?.updated ? String(s.time.updated) : "",
      status: "active" as const,
    }));
  }

  async createSession(title?: string): Promise<ProviderSession> {
    if (!this._client) {
      throw new Error("Not connected");
    }
    const result = await this._client.session.create({
      body: { title: title ?? "Desk Escape" },
    });
    if (!result.data) {
      throw new Error("Failed to create session");
    }
    const s = result.data;
    return {
      id: s.id,
      title: s.title ?? "Untitled",
      createdAt: s.time?.created ? String(s.time.created) : "",
      updatedAt: s.time?.updated ? String(s.time.updated) : "",
      status: "active",
    };
  }

  async deleteSession(id: string): Promise<void> {
    if (!this._client) {
      throw new Error("Not connected");
    }
    await this._client.session.delete({ path: { id } });
  }

  async selectSession(id: string): Promise<ProviderSession> {
    if (!this._client) {
      throw new Error("Not connected");
    }
    const result = await this._client.session.get({ path: { id } });
    if (!result.data) {
      throw new Error("Session not found");
    }
    const s = result.data;
    return {
      id: s.id,
      title: s.title ?? "Untitled",
      createdAt: s.time?.created ? String(s.time.created) : "",
      updatedAt: s.time?.updated ? String(s.time.updated) : "",
      status: "active",
    };
  }

  async getMessages(sessionId: string): Promise<MessageWithParts[]> {
    if (!this._client) {
      throw new Error("Not connected");
    }
    const result = await this._client.session.messages({
      path: { id: sessionId },
    });
    return (result.data ?? []) as MessageWithParts[];
  }

  async sendPrompt(
    sessionId: string,
    text: string,
    attachments?: { path: string; name: string }[],
  ): Promise<void> {
    if (!this._client) {
      throw new Error("Not connected");
    }
    const attachmentParts = (attachments ?? []).map((a) => ({
      type: "text" as const,
      text: `Context attachment: ${a.path}`,
    }));
    await this._client.session.prompt({
      path: { id: sessionId },
      body: {
        parts: [...attachmentParts, { type: "text", text }],
      },
    });
  }

  subscribe(callback: (event: unknown) => void): () => void {
    return this.eventBus.onEvent(callback);
  }

  async getCurrentProject(): Promise<{ worktree?: string } | null> {
    if (!this._client) {
      return null;
    }
    return fetchCurrentProject(this._client);
  }

  async listProjects(): Promise<{ worktree: string }[]> {
    if (!this._client) {
      return [];
    }
    return fetchProjectList(this._client);
  }

  async selectProject(_worktree: string): Promise<void> {
    // Project switching uses directory query params in OpenCode
  }

  async listCommands(): Promise<{ name: string; description?: string }[]> {
    if (!this._client) {
      return [];
    }
    const result = await this._client.command.list();
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
    if (!this._client) {
      throw new Error("Not connected");
    }
    await this._client.session.command({
      path: { id: sessionId },
      body: {
        command,
        arguments: args ?? "",
      },
    });
  }
}

export function createOpenCodeProvider(): OpenCodeProvider {
  return new OpenCodeProvider();
}
