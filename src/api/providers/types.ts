import type {
  Message,
  Part,
  ToolPart,
  Agent,
  Project,
  Session,
} from "@opencode-ai/sdk/client";

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
  | OpenCodeConnectionConfig
  | CursorConnectionConfig;

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

type MessageWithParts = {
  info: Message;
  parts: Part[];
};

export interface AgentProvider {
  readonly type: AgentProviderType;
  readonly name: string;
  readonly supportsTerminal: boolean;
  readonly supportsFileBrowser: boolean;

  connect(config: AnyConnectionConfig, password?: string): Promise<void>;
  disconnect(): Promise<void>;
  testConnection(
    config: AnyConnectionConfig,
    password?: string,
  ): Promise<HealthResult>;

  listSessions(): Promise<ProviderSession[]>;
  createSession(title?: string): Promise<ProviderSession>;
  deleteSession(id: string): Promise<void>;
  selectSession(id: string): Promise<ProviderSession>;

  getMessages(sessionId: string): Promise<MessageWithParts[]>;
  sendPrompt(
    sessionId: string,
    text: string,
    attachments?: { path: string; name: string }[],
  ): Promise<void>;

  subscribe(callback: (event: unknown) => void): () => void;

  getCurrentProject(): Promise<{ worktree?: string } | null>;
  listProjects(): Promise<{ worktree: string }[]>;
  selectProject(worktree: string): Promise<void>;

  listCommands(): Promise<{ name: string; description?: string }[]>;
  executeCommand(
    sessionId: string,
    command: string,
    args?: string,
  ): Promise<void>;
}
