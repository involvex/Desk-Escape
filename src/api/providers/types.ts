import type { ChatMessage } from "@/types/domain";

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

  getMessages(sessionId: string): Promise<ChatMessage[]>;
  sendPrompt(
    sessionId: string,
    text: string,
    attachments?: { path: string; name: string }[],
  ): Promise<void>;

  /**
   * Cancels the in-flight turn, so the composer can offer a Stop affordance.
   *
   * Resolves `false` when nothing was running, which is not an error: the turn
   * may simply have finished between the user tapping Stop and the request
   * landing.
   */
  interruptSession(sessionId: string): Promise<boolean>;

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
