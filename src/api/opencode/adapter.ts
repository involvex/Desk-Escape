import type {
  FileDiffInfo,
  FileSystemEntry,
  ModelInfo,
  ProviderInfo,
  SessionInfo,
  SessionMessageAssistant,
  SessionMessageInfo,
  SessionMessageToolStateCompleted,
  SessionMessageToolStateError,
  SessionMessageToolStateRunning,
  SessionMessageToolStateStreaming,
  TokenUsageInfo,
  ToolContent,
  VcsFileStatus,
} from "@opencode/client";

import type {
  ChatMessage,
  ChatMessageKind,
  ChatPart,
  ChatTextPart,
  ChatToolContent,
  ChatToolPart,
  ChatToolStatus,
  FileEntry,
  Model,
  ModelCapabilities,
  ModelCost,
  Session,
} from "@/types/domain";
import type { DiffHunk, FileDiffEntry } from "@/types/opencode";

/**
 * Translation from OpenCode V2 wire types to the app's domain model.
 *
 * The largest structural change in V2 is that assistant content arrived inline:
 * V1 returned `{ info: Message, parts: Part[] }` from two separate concerns,
 * while V2 returns one message whose `content[]` holds text, reasoning and tool
 * entries. This module rebuilds the `parts` array from `content` so the chat UI,
 * which is written against `message.parts`, keeps working.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function basename(path: string): string {
  const segments = path.replace(/\\/g, "/").split("/");
  return segments[segments.length - 1] || path;
}

/**
 * Stable id for a positional content slot.
 *
 * V2 streams deltas addressed by `ordinal` (the index into `content[]`), so
 * deriving ids as `<messageID>:<ordinal>` lets the stream reducer locate the
 * right part without inventing a separate lookup table.
 */
export function positionalPartId(messageId: string, ordinal: number): string {
  return `${messageId}:${ordinal}`;
}

function toChatToolContent(content: ToolContent[]): ChatToolContent[] {
  return content.map((entry) =>
    entry.type === "text"
      ? { type: "text" as const, text: entry.text }
      : {
          type: "file" as const,
          uri: entry.uri,
          mime: entry.mime,
          name: entry.name ?? null,
        },
  );
}

interface ToolStateParts {
  status: ChatToolStatus;
  input?: Record<string, unknown>;
  rawInput?: string;
  content?: ChatToolContent[];
  error?: string;
  metadata?: Record<string, unknown>;
}

function readToolState(
  state:
    | SessionMessageToolStateStreaming
    | SessionMessageToolStateRunning
    | SessionMessageToolStateCompleted
    | SessionMessageToolStateError,
): ToolStateParts {
  switch (state.status) {
    case "streaming":
      // Arguments are still arriving as raw JSON.
      return { status: "streaming", rawInput: state.input };
    case "running":
      return {
        status: "running",
        input: state.input as Record<string, unknown>,
        metadata: state.metadata as Record<string, unknown>,
      };
    case "completed":
      return {
        status: "completed",
        input: state.input as Record<string, unknown>,
        content: toChatToolContent(state.content),
        metadata: state.metadata as Record<string, unknown> | undefined,
      };
    case "error":
      return {
        status: "error",
        input: state.input as Record<string, unknown>,
        content: state.content ? toChatToolContent(state.content) : undefined,
        error: state.error.message,
        metadata: state.metadata as Record<string, unknown> | undefined,
      };
    default:
      return { status: "error" };
  }
}

function toChatTokens(tokens: TokenUsageInfo | undefined) {
  if (!tokens) {
    return undefined;
  }
  return {
    input: tokens.input,
    output: tokens.output,
    reasoning: tokens.reasoning,
    cache: { read: tokens.cache.read, write: tokens.cache.write },
  };
}

function toChatError(
  error: { message: string } | undefined,
): string | undefined {
  return error?.message;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function textPart(
  messageId: string,
  ordinal: number,
  text: string,
): ChatTextPart {
  return { id: positionalPartId(messageId, ordinal), type: "text", text };
}

function assistantParts(message: SessionMessageAssistant): ChatPart[] {
  return message.content.map((entry, ordinal) => {
    switch (entry.type) {
      case "text":
        return textPart(message.id, ordinal, entry.text);
      case "reasoning":
        return {
          id: positionalPartId(message.id, ordinal),
          type: "reasoning" as const,
          text: entry.text,
          time: entry.time,
        };
      case "tool": {
        const { status, input, rawInput, content, error, metadata } =
          readToolState(entry.state);
        return {
          id: entry.id,
          type: "tool" as const,
          tool: entry.name,
          status,
          input,
          rawInput,
          content,
          error,
          metadata,
          time: entry.time,
        } satisfies ChatToolPart;
      }
      default:
        // Exhaustiveness guard: an unhandled content variant should surface
        // during development rather than vanish from the transcript.
        return textPart(message.id, ordinal, "");
    }
  });
}

/**
 * V2 metadata-only messages (`agent-switched`, `model-switched`,
 * `location-switched`, `idle`) carry no user- or assistant-authored content.
 * The UI already surfaces the active agent and model in its toolbar, so these
 * are dropped from the transcript instead of rendered as empty bubbles.
 */
export function isDisplayableMessage(message: SessionMessageInfo): boolean {
  return !(
    message.type === "agent-switched" ||
    message.type === "model-switched" ||
    message.type === "location-switched" ||
    message.type === "idle"
  );
}

export function toChatMessage(message: SessionMessageInfo): ChatMessage | null {
  if (!isDisplayableMessage(message)) {
    return null;
  }

  const base = {
    id: message.id,
    time: { created: message.time.created },
  };

  switch (message.type) {
    case "assistant": {
      return {
        info: {
          ...base,
          role: "assistant",
          kind: "assistant",
          time: {
            created: message.time.created,
            completed: message.time.completed,
          },
          modelID: message.model?.id,
          providerID: message.model?.providerID,
          agent: message.agent,
          cost: message.cost,
          tokens: toChatTokens(message.tokens),
          finish: message.finish,
          error: toChatError(message.error),
        },
        parts: assistantParts(message),
      };
    }

    case "user":
      return {
        info: { ...base, role: "user", kind: "user" },
        parts: [textPart(message.id, 0, message.text)],
      };

    case "system":
    case "synthetic":
    case "skill": {
      const kind: ChatMessageKind = message.type;
      return {
        info: { ...base, role: "assistant", kind },
        parts: [textPart(message.id, 0, message.text)],
      };
    }

    case "compaction": {
      // Only the running and completed variants carry a summary; the failed
      // variant has an error instead. `cost`/`tokens` are absent while running.
      const failed = message.status === "failed";
      const running = message.status === "running";
      return {
        info: {
          ...base,
          role: "assistant",
          kind: "compaction",
          cost: running ? undefined : message.cost,
          tokens: running ? undefined : toChatTokens(message.tokens),
          error: failed ? message.error.message : undefined,
        },
        parts: [textPart(message.id, 0, failed ? "" : message.summary)],
      };
    }

    case "shell": {
      const output = message.output?.output ?? "";
      const part: ChatToolPart = {
        id: message.shellID,
        type: "tool",
        tool: "shell",
        status:
          message.status === "running"
            ? "running"
            : message.status === "exited" && message.exit === 0
              ? "completed"
              : "error",
        input: { command: message.command },
        content: output ? [{ type: "text", text: output }] : undefined,
        error:
          message.status !== "running" && message.exit !== 0
            ? `Exited with ${String(message.exit ?? "unknown")}`
            : undefined,
        time: {
          created: message.time.created,
          completed: message.time.completed,
        },
      };
      return {
        info: {
          ...base,
          role: "assistant",
          kind: "shell",
          exit: typeof message.exit === "number" ? message.exit : undefined,
        },
        parts: [part],
      };
    }

    default:
      return null;
  }
}

export function toChatMessages(messages: SessionMessageInfo[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (const message of messages) {
    const converted = toChatMessage(message);
    if (converted) {
      result.push(converted);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export function toSession(info: SessionInfo): Session {
  return {
    id: info.id,
    title: info.title,
    // V2 wraps this as `location.directory`; there is no top-level `directory`.
    directory: info.location?.directory,
    parentID: info.parentID,
    projectID: info.projectID,
    time: { created: info.time.created, updated: info.time.updated },
    cost: info.cost,
    tokens: toChatTokens(info.tokens),
    outcome: info.outcome,
  };
}

// ---------------------------------------------------------------------------
// Files, models, providers
// ---------------------------------------------------------------------------

/**
 * V2 returns a flat list of `{ path, type }` with no children and no size, so
 * the display name is derived from the path.
 */
export function toFileEntry(entry: FileSystemEntry): FileEntry {
  return {
    path: entry.path,
    name: basename(entry.path),
    type: entry.type,
  };
}

/**
 * Normalize a workspace-relative path for use as a map key.
 *
 * V2 paths may arrive with either separator depending on the host OS, while
 * the listing (`file.list`) and the status (`vcs.status`) endpoints can disagree
 * on which one they use for the same file. Folding separators and dropping a
 * leading `./` keeps the two comparable.
 */
function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

/**
 * Sort a directory listing the way a file tree expects: directories first,
 * then case-insensitive by display name.
 *
 * V2 returns a flat, unordered array, so ordering has to be imposed here rather
 * than relied on from the server.
 */
function compareEntries(left: FileEntry, right: FileEntry): number {
  if (left.type !== right.type) {
    return left.type === "directory" ? -1 : 1;
  }
  return left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

/**
 * Convert one `file.list` page of flat entries into domain entries.
 *
 * V2 dropped `children` and `size`, so the tree is assembled by descending with
 * further `file.list` calls; no `FileEntry` produced here carries either field.
 */
export function toFileEntries(
  entries: readonly FileSystemEntry[],
): FileEntry[] {
  return entries.map(toFileEntry).sort(compareEntries);
}

/**
 * Defensive view over a file listing whose provenance is not statically known.
 *
 * The React Query layer owns the network call, and its return type is being
 * migrated independently, so the file browser normalizes at render time instead
 * of asserting a wire shape. Anything that is not a recognizable entry is
 * dropped rather than rendered as a broken row.
 */
export function toFileEntryList(value: unknown): FileEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const entries: FileEntry[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const candidate = raw as Partial<FileSystemEntry> & Partial<FileEntry>;
    if (typeof candidate.path !== "string" || !candidate.path) {
      continue;
    }
    const type: FileEntry["type"] | undefined =
      candidate.type === "directory"
        ? "directory"
        : candidate.type === "file"
          ? "file"
          : undefined;
    if (!type) {
      continue;
    }
    entries.push({
      path: candidate.path,
      name:
        typeof candidate.name === "string" && candidate.name
          ? candidate.name
          : basename(candidate.path),
      type,
    });
  }

  return entries.sort(compareEntries);
}

/**
 * Path-keyed index over `client.vcs.status`.
 *
 * V2 returns a flat array of `VcsFileStatus` instead of V1's per-path object,
 * so every consumer has to key it itself.
 */
export type FileStatusIndex = ReadonlyMap<string, VcsFileStatus>;

export function indexFileStatuses(
  statuses: readonly VcsFileStatus[] | undefined,
): FileStatusIndex {
  const index = new Map<string, VcsFileStatus>();
  for (const entry of statuses ?? []) {
    if (typeof entry?.file === "string" && entry.file) {
      index.set(normalizePath(entry.file), entry);
    }
  }
  return index;
}

/**
 * Derive untracked files by subtracting the VCS status from a directory listing.
 *
 * V2 dropped V1's `"untracked"` status, so a file git has never seen is absent
 * from `vcs.status` entirely. Subtracting the status keys from the paths that
 * `file.list` actually reports reconstructs that set. Without this, a brand new
 * file is invisible to the diff view.
 *
 * `additions`/`deletions` are `0` rather than measured: the line counts would
 * require reading and diffing each file, which the diff endpoints already do.
 */
export function markUntracked(
  listedPaths: readonly string[],
  known: FileStatusIndex,
): VcsFileStatus[] {
  return listedPaths
    .filter((path) => !known.has(normalizePath(path)))
    .map((file) => ({
      file,
      additions: 0,
      deletions: 0,
      status: "added" as const,
    }));
}

// ---------------------------------------------------------------------------
// Diffs
// ---------------------------------------------------------------------------

/**
 * Parse a unified diff patch into hunks.
 *
 * V2 returns patches as text on `FileDiffInfo.patch` (V1 hid the same text
 * behind `file.read(...).data.diff`), so parsing is now explicit. Lines before
 * the first `@@` are file headers and are skipped; `\\ No newline at end of
 * file` markers are dropped rather than rendered as context.
 */
export function parseUnifiedDiff(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;

  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) {
      current = { header: line, lines: [] };
      hunks.push(current);
      continue;
    }
    if (!current || line.startsWith("\\")) {
      continue;
    }
    if (line.startsWith("+")) {
      current.lines.push({ type: "add", content: line.slice(1) });
    } else if (line.startsWith("-")) {
      current.lines.push({ type: "remove", content: line.slice(1) });
    } else if (line.startsWith(" ")) {
      current.lines.push({ type: "context", content: line.slice(1) });
    }
  }

  return hunks;
}

/** Adapt one `FileDiffInfo` from `vcs.diff` / `session.diff` to the UI model. */
export function toFileDiffEntry(info: FileDiffInfo): FileDiffEntry {
  return {
    path: info.file,
    hunks: parseUnifiedDiff(info.patch ?? ""),
  };
}

function toCapabilities(info: ModelInfo): ModelCapabilities {
  const input = info.capabilities?.input ?? [];
  return {
    // V1 exposed `reasoning`/`attachment`/`tool_call` as booleans. V2 folds
    // attachment into modality lists and reasoning into compatibility.
    reasoning: Boolean(info.compatibility?.reasoningField),
    toolCall: Boolean(info.capabilities?.tools),
    attachment: input.some((modality) => modality !== "text"),
    temperature: true,
    input,
    output: info.capabilities?.output ?? [],
  };
}

/** V2 tiers model cost; the UI shows the first tier. */
function toCost(info: ModelInfo): ModelCost {
  const first = info.cost?.[0];
  return {
    input: first?.input ?? 0,
    output: first?.output ?? 0,
    cache: { read: first?.cache?.read ?? 0, write: first?.cache?.write ?? 0 },
  };
}

export function toModel(info: ModelInfo): Model {
  return {
    id: info.id,
    modelID: info.modelID,
    name: info.name,
    providerID: info.providerID,
    family: info.family,
    status: info.status,
    enabled: info.enabled,
    capabilities: toCapabilities(info),
    cost: toCost(info),
    limit: {
      context: info.limit?.context ?? 0,
      output: info.limit?.output,
    },
    variants: info.variants?.map((variant) => variant.id),
  };
}

export function toProvider(
  info: ProviderInfo,
  models: Model[],
): {
  id: string;
  name: string;
  models: Record<string, Model>;
} {
  const owned = models.filter((model) => model.providerID === info.id);
  return {
    id: info.id,
    name: info.name,
    models: Object.fromEntries(owned.map((model) => [model.id, model])),
  };
}
