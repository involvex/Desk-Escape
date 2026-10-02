export type AgentProviderType = "opencode" | "cursor";

/**
 * Server data types now live in `@/types/domain` so that neither provider's
 * wire shape leaks into the UI. Re-exported here for existing import sites.
 */
export type {
  Agent,
  ChatMessage,
  ChatMessageInfo,
  ChatMessageKind,
  ChatPart,
  ChatReasoningPart,
  ChatTextPart,
  ChatTokenUsage,
  ChatToolContent,
  ChatToolPart,
  ChatToolStatus,
  Command,
  FileEntry,
  MessageWithParts,
  Model,
  ModelCapabilities,
  ModelCost,
  Project,
  Provider,
  Session,
} from "@/types/domain";

export type ThemeName =
  | "oled-black"
  | "dev-dark"
  | "dev-light"
  | "midnight-purple"
  | "solarized-dark"
  | "nord"
  | "high-contrast"
  | "hacker";

export type FontScale = 0.85 | 1 | 1.15 | 1.3;

export type FontType = "system" | "mono";

export type OrientationMode = "portrait" | "auto" | "landscape";

export type ConnectionStatus =
  "disconnected" | "connecting" | "connected" | "error" | "reconnecting";

export type TestConnectionStatus = "idle" | "testing" | "success" | "error";

export type WorkspacePanel = "agent" | "files" | "terminal" | "diff";

export interface ConnectionConfig {
  type?: AgentProviderType;
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

export { toolDurationMs, toolOutputText } from "@/types/domain";

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

export interface QueuedMessage {
  id: string;
  text: string;
  attachments: { path: string; name: string }[];
  timestamp: number;
}

export type BiometricLockState = "locked" | "unlocking" | "unlocked";
