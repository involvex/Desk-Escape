/**
 * App-owned domain model.
 *
 * Nothing in this file may import from `@opencode/client` (or from the old
 * `@opencode-ai/sdk`). These types are the contract between the OpenCode V2
 * adapter, the Cursor provider, React Query hooks and the UI, which keeps
 * server-specific shape changes out of the component layer and lets both
 * providers satisfy the same interface.
 *
 * Field names are chosen to stay close to what the V1 SDK exposed, because the
 * existing UI reads them by name. The adapter is responsible for translating.
 *
 * The resolved server configuration lives in `@/api/opencode/config` rather than
 * here, since it folds V2's list of source documents and is server-shaped.
 */

// ---------------------------------------------------------------------------
// Chat messages
// ---------------------------------------------------------------------------

/** Which V2 message variant an entry originated from. */
export type ChatMessageKind =
  | "user"
  | "assistant"
  | "system"
  | "synthetic"
  | "skill"
  | "shell"
  | "compaction";

export interface ChatTokenUsage {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
}

export interface ChatMessageInfo {
  id: string;
  /** Coarse bucket used for bubble placement: user messages sit on the right. */
  role: "user" | "assistant";
  /** Finer discriminator; `role` collapses several V2 types into "assistant". */
  kind: ChatMessageKind;
  time: { created: number; completed?: number };
  modelID?: string;
  providerID?: string;
  agent?: string;
  cost?: number;
  tokens?: ChatTokenUsage;
  finish?: string;
  error?: string;
  /** Exit status, present only on `shell` messages. */
  exit?: number;
}

export type ChatToolStatus = "streaming" | "running" | "completed" | "error";

export type ChatToolContent =
  | { type: "text"; text: string }
  | { type: "file"; uri: string; mime: string; name?: string | null };

export interface ChatTextPart {
  id: string;
  type: "text";
  text: string;
}

export interface ChatReasoningPart {
  id: string;
  type: "reasoning";
  text: string;
  time?: { created: number; completed?: number };
}

export interface ChatToolPart {
  id: string;
  type: "tool";
  /** Tool name, e.g. `read`, `edit`, `bash`. */
  tool: string;
  status: ChatToolStatus;
  /** Parsed arguments. Absent while still streaming. */
  input?: Record<string, unknown>;
  /** Raw partial JSON, present only while `status === "streaming"`. */
  rawInput?: string;
  /** Structured results. V2 replaced V1's single `output: string` with this. */
  content?: ChatToolContent[];
  error?: string;
  metadata?: Record<string, unknown>;
  time?: { created: number; ran?: number; completed?: number };
}

export type ChatPart = ChatTextPart | ChatReasoningPart | ChatToolPart;

/**
 * A chat entry and its rendered content.
 *
 * The `info`/`parts` split is retained from the V1 SDK because the chat UI
 * indexes into it heavily. V2 delivers content inline on the message instead,
 * so the adapter synthesizes `parts` from `message.content`.
 */
export interface ChatMessage {
  info: ChatMessageInfo;
  parts: ChatPart[];
}

/** Legacy alias kept for call sites that still say `MessageWithParts`. */
export type MessageWithParts = ChatMessage;

/** Render a tool's results as plain text, mirroring V1's `state.output`. */
export function toolOutputText(part: ChatToolPart): string {
  if (!part.content?.length) {
    return "";
  }
  return part.content
    .map((entry) => (entry.type === "text" ? entry.text : `[${entry.type}]`))
    .join("\n");
}

/** Milliseconds between a tool starting and completing, when both are known. */
export function toolDurationMs(part: ChatToolPart): number | undefined {
  if (!part.time?.created) {
    return undefined;
  }
  const end = part.time.completed ?? part.time.ran;
  if (end === undefined) {
    return undefined;
  }
  return Math.max(0, end - part.time.created);
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface SessionSummary {
  additions: number;
  deletions: number;
}

/**
 * Session metadata. `directory` is derived by the adapter from V2's
 * `location.directory`, which does not exist as a top-level field.
 */
export interface Session {
  id: string;
  title?: string;
  directory?: string;
  parentID?: string;
  projectID?: string;
  time: { created: number; updated: number };
  summary?: SessionSummary;
  cost?: number;
  tokens?: ChatTokenUsage;
  /** Outcome of the last turn, when the server reported one. */
  outcome?: "succeeded" | "failed" | "interrupted";
}

// ---------------------------------------------------------------------------
// Agents, models, providers, commands
// ---------------------------------------------------------------------------

export interface AgentModelRef {
  providerID: string;
  modelID: string;
  variant?: string;
}

export interface Agent {
  /** Stable identifier. V2 exposes this as `id`. */
  name: string;
  description?: string;
  mode: "primary" | "subagent" | "all";
  color?: string;
  model?: AgentModelRef;
  hidden?: boolean;
}

/** Model capabilities, flattened to the booleans the picker renders. */
export interface ModelCapabilities {
  reasoning: boolean;
  toolCall: boolean;
  attachment: boolean;
  temperature: boolean;
  /** Supported input modalities, e.g. `["text", "image"]`. */
  input: string[];
  output: string[];
}

export interface ModelCost {
  input: number;
  output: number;
  cache: { read: number; write: number };
}

export interface Model {
  id: string;
  name: string;
  providerID: string;
  family?: string;
  status: "alpha" | "beta" | "active" | "deprecated";
  enabled: boolean;
  capabilities: ModelCapabilities;
  cost: ModelCost;
  limit: { context: number; output?: number };
  /** Bare model id within the provider, when the server distinguishes it. */
  modelID?: string;
  variants?: string[];
}

export interface Provider {
  id: string;
  name: string;
  models: Record<string, Model>;
}

export interface Command {
  name: string;
  description?: string;
}

// ---------------------------------------------------------------------------
// Project and files
// ---------------------------------------------------------------------------

export interface Project {
  id: string;
  /** V1 named this `worktree`; V2 splits it into `worktree.*` and location. */
  worktree?: string;
  vcs?: string;
  name?: string;
}

/**
 * A directory entry. V2's `FileSystemEntry` is a flat list with no children and
 * no size; the tree is assembled client-side from repeated `file.list` calls.
 */
export interface FileEntry {
  path: string;
  name: string;
  type: "file" | "directory";
  /** V1 reported these; V2 does not, so they stay undefined. */
  size?: number;
  children?: FileEntry[];
}
