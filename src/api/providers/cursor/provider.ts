import type {
  AnyConnectionConfig,
  AgentProvider,
  CursorConnectionConfig,
  HealthResult,
  ProviderSession,
} from "@/api/providers/types";
import type { CursorStreamEvent } from "./types";
import { CursorApiClient } from "./client";
import { CursorEventBus } from "./event-bus";
import { applyCursorStreamEvent } from "./message-stream";
import type { MessageWithParts } from "@/types/opencode";

export class CursorProvider implements AgentProvider {
  readonly type = "cursor" as const;
  readonly name = "Cursor Cloud Agents";
  readonly supportsTerminal = false;
  readonly supportsFileBrowser = false;

  private _apiKey: string | null = null;
  private _config: CursorConnectionConfig | null = null;
  private _client: CursorApiClient | null = null;
  private eventBus = new CursorEventBus();
  private _agentId: string | null = null;
  private _messages: MessageWithParts[] = [];
  private _listeners: Set<(event: unknown) => void> = new Set();
  /** Id of the run currently streaming, so it can be cancelled. */
  private _currentRunId: string | null = null;

  get currentClient(): CursorApiClient | null {
    return this._client;
  }

  get currentAgentId(): string | null {
    return this._agentId;
  }

  async connect(config: AnyConnectionConfig, password?: string): Promise<void> {
    if (config.type !== "cursor") {
      throw new Error("Invalid config type for Cursor provider");
    }
    this._config = config;
    this._apiKey = password ?? config.apiKey;
    this._client = new CursorApiClient(this._apiKey);
  }

  async disconnect(): Promise<void> {
    this.eventBus.stop();
    this._client = null;
    this._apiKey = null;
    this._config = null;
    this._agentId = null;
    this._messages = [];
    this._currentRunId = null;
  }

  async testConnection(
    config: AnyConnectionConfig,
    password?: string,
  ): Promise<HealthResult> {
    if (config.type !== "cursor") {
      throw new Error("Invalid config type for Cursor provider");
    }
    const apiKey = password ?? config.apiKey;
    if (!apiKey) {
      throw new Error("API key is required.");
    }
    const tempClient = new CursorApiClient(apiKey);
    const me = await tempClient.testConnection();
    return { healthy: me.healthy };
  }

  async listSessions(): Promise<ProviderSession[]> {
    if (!this._client) {
      throw new Error("Not connected");
    }
    const result = await this._client.listAgents();
    return (result.items ?? []).map((agent) => ({
      id: agent.id,
      title: agent.name ?? agent.id,
      createdAt: agent.createdAt ?? "",
      updatedAt: agent.updatedAt ?? "",
      status: agent.status === "ACTIVE" ? "active" : "idle",
    }));
  }

  async createSession(title?: string): Promise<ProviderSession> {
    if (!this._client) {
      throw new Error("Not connected");
    }
    if (!this._config) {
      throw new Error("No config");
    }
    const result = await this._client.createAgent({
      prompt: { text: title ?? "Desk Escape Session" },
      repos: [
        {
          url: this._config.repoUrl,
          startingRef: this._config.branch,
        },
      ],
    });
    if (!result.agent) {
      throw new Error("Failed to create agent");
    }
    const agent = result.agent;
    return {
      id: agent.id,
      title: agent.name ?? "Untitled",
      createdAt: agent.createdAt ?? "",
      updatedAt: agent.updatedAt ?? "",
      status: agent.status === "ACTIVE" ? "active" : "idle",
    };
  }

  async deleteSession(id: string): Promise<void> {
    if (!this._client) {
      throw new Error("Not connected");
    }
    await this._client.deleteAgent(id);
    if (this._agentId === id) {
      this._agentId = null;
      this._messages = [];
      this._currentRunId = null;
    }
  }

  async selectSession(id: string): Promise<ProviderSession> {
    if (!this._client) {
      throw new Error("Not connected");
    }
    this._agentId = id;
    this._messages = [];
    this._currentRunId = null;
    const agent = await this._client.getAgent(id);
    return {
      id: agent.id,
      title: agent.name ?? agent.id,
      createdAt: agent.createdAt ?? "",
      updatedAt: agent.updatedAt ?? "",
      status: agent.status === "ACTIVE" ? "active" : "idle",
    };
  }

  async getMessages(_sessionId: string): Promise<MessageWithParts[]> {
    return this._messages;
  }

  async sendPrompt(
    _sessionId: string,
    text: string,
    _attachments?: { path: string; name: string }[],
  ): Promise<void> {
    if (!this._client) {
      throw new Error("Not connected");
    }
    if (!this._agentId) {
      throw new Error("No agent selected");
    }

    const result = await this._client.createRun(this._agentId, {
      prompt: { text },
    });
    if (!result.run) {
      throw new Error("Failed to create run");
    }

    const run = result.run;
    this._currentRunId = run.id;

    // Register the reducer once per send, and detach it again afterwards.
    // Previously this subscription was never removed, so every prompt added a
    // permanent listener: after N prompts each event was folded into
    // `this._messages` N times, multiplying the transcript and eventually
    // exhausting memory.
    const unsubscribe = this.eventBus.onEvent((event) => {
      const typedEvent = event as CursorStreamEvent;
      const updated = applyCursorStreamEvent(
        this._messages,
        typedEvent,
        run.id,
      );
      if (updated) {
        this._messages = updated;
      }
      for (const listener of this._listeners) {
        listener(event);
      }
    });

    try {
      await this.eventBus.start(this._client, this._agentId, run.id);
    } finally {
      // `start` resolves when the stream ends, so the subscription has served
      // its purpose either way.
      unsubscribe();
    }
  }

  /**
   * Cancels the active run for the selected agent.
   *
   * Used by the composer Stop affordance; without it a Cursor run can only be
   * abandoned by closing the app.
   */
  async interruptSession(_sessionId: string): Promise<boolean> {
    if (!this._client) {
      throw new Error("Not connected");
    }
    if (!this._agentId) {
      throw new Error("No agent selected");
    }
    const run = this._currentRunId;
    if (!run) {
      // Nothing in flight, so there is nothing to cancel.
      return false;
    }

    await this._client.cancelRun(this._agentId, run);
    // Stop the SSE reader so the cancelled run stops emitting.
    this.eventBus.stop();
    this._currentRunId = null;
    return true;
  }

  subscribe(callback: (event: unknown) => void): () => void {
    this._listeners.add(callback);
    return () => {
      this._listeners.delete(callback);
    };
  }

  async getCurrentProject(): Promise<{ worktree?: string } | null> {
    return null;
  }

  async listProjects(): Promise<{ worktree: string }[]> {
    return [];
  }

  async selectProject(_worktree: string): Promise<void> {
    // Not applicable for Cursor Cloud Agents
  }

  async listCommands(): Promise<{ name: string; description?: string }[]> {
    return [];
  }

  async executeCommand(
    _sessionId: string,
    _command: string,
    _args?: string,
  ): Promise<void> {
    throw new Error("Terminal not supported for Cursor Cloud Agents");
  }
}
