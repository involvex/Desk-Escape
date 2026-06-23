import type {
  Agent,
  Message,
  Part,
  Project,
  Session,
  ToolPart,
} from "@opencode-ai/sdk/client";

export type { Agent, Message, Part, Project, Session, ToolPart };

export type ThemeName =
  | "oled-black"
  | "dev-dark"
  | "dev-light"
  | "midnight-purple"
  | "solarized-dark"
  | "nord"
  | "high-contrast";

export type FontScale = 0.85 | 1 | 1.15 | 1.3;

export type OrientationMode = "portrait" | "auto" | "landscape";

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export type TestConnectionStatus = "idle" | "testing" | "success" | "error";

export type WorkspacePanel = "agent" | "files" | "terminal" | "diff";

export interface ConnectionConfig {
  baseUrl: string;
  host: string;
  port: number;
  username: string;
  useAuth: boolean;
}

export interface BasicAuthCredential {
  username: string;
  password: string;
}

export interface StoredConnectionConfig extends ConnectionConfig {
  label: string;
  lastConnectedAt: string;
}

export interface ContextAttachment {
  id: string;
  path: string;
  addedAt: string;
}

export interface ParsedTarget {
  baseUrl: string;
  host: string;
  port: number;
}

export interface HealthResult {
  healthy: boolean;
  version?: string;
}

export interface MessageWithParts {
  info: Message;
  parts: Part[];
}

export interface DiffLine {
  type: "add" | "remove" | "context";
  content: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface FileDiffEntry {
  path: string;
  hunks: DiffHunk[];
}

export interface ConnectionDraft {
  target: string;
  useAuth: boolean;
  username: string;
}

export interface PromptPreset {
  id: string;
  label: string;
  text: string;
}
