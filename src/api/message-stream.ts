import type { ToolContent, V2Event } from "@opencode/client";

import { positionalPartId } from "@/api/opencode/adapter";
import type {
  ChatMessage,
  ChatMessageInfo,
  ChatPart,
  ChatReasoningPart,
  ChatTextPart,
  ChatToolContent,
  ChatToolPart,
} from "@/types/domain";

/**
 * Reducer for the V2 event stream.
 *
 * V1 delivered whole `message.part.updated` snapshots addressed by part id.
 * V2 delivers fine-grained deltas instead, and — crucially — addresses them by
 * `ordinal`, the index of the entry in `message.content[]`. Text and reasoning
 * entries therefore get their ids derived as `<messageID>:<ordinal>`, which is
 * exactly what `positionalPartId` produces and what the adapter emits when
 * hydrating from a snapshot. That shared derivation is what lets a streamed
 * part and a re-fetched part be recognized as the same entry.
 *
 * Tool entries keep their own server-generated `id`, which is also what the
 * adapter uses, so tool parts address by `data.id`.
 */

/** Every V2 event payload; only some carry a session. */
function eventSessionId(event: V2Event): string | undefined {
  return "sessionID" in event.data ? event.data.sessionID : undefined;
}

/** V1 delivered whole parts; V2 splits results into typed content entries. */
function toToolContent(content: ToolContent[]): ChatToolContent[] {
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

// ---------------------------------------------------------------------------
// List helpers
// ---------------------------------------------------------------------------

/**
 * Applies `mutate` to the message with `messageId`, creating a bare assistant
 * message when the stream has not produced one yet.
 *
 * V2 does not emit a `message.created` equivalent, so the opening text would
 * be dropped if the reducer required the message to already exist — the first
 * thing seen after a prompt is usually `session.step.started` or a delta.
 */
function updateMessage(
  messages: ChatMessage[],
  messageId: string,
  created: number,
  mutate: (message: ChatMessage) => ChatMessage,
): ChatMessage[] {
  const index = messages.findIndex((item) => item.info.id === messageId);
  const existing = index === -1 ? undefined : messages[index];

  const base: ChatMessage = existing ?? {
    info: {
      id: messageId,
      role: "assistant",
      kind: "assistant",
      time: { created },
    },
    parts: [],
  };

  const next = mutate(base);

  if (index === -1) {
    return [...messages, next];
  }

  const copy = [...messages];
  copy[index] = next;
  return copy;
}

function replaceAt<T>(items: T[], index: number, value: T): T[] {
  const copy = [...items];
  copy[index] = value;
  return copy;
}

/**
 * Appends `delta` to the text/reasoning part named by `partId`.
 *
 * A delta may arrive without its `started` event when the stream is
 * reconnected mid-part, so the part is created on demand.
 */
function appendToStreamedPart(
  parts: ChatPart[],
  part: ChatTextPart | ChatReasoningPart,
  delta: string,
): ChatPart[] {
  const index = parts.findIndex((item) => item.id === part.id);
  if (index === -1) {
    return [...parts, { ...part, text: part.text + delta }];
  }

  const existing = parts[index];
  if (
    !existing ||
    (existing.type !== "text" && existing.type !== "reasoning")
  ) {
    // A part of a different kind already occupies this ordinal. The server's
    // ordinal wins, so the stale occupant is replaced rather than appended
    // alongside: appending would leave two parts sharing one id, which
    // collides as a list key and makes later lookups by id resolve the stale
    // entry. `part.text` is applied so the current delta is not dropped.
    return replaceAt(parts, index, { ...part, text: part.text + delta });
  }

  return replaceAt(parts, index, {
    ...existing,
    ...part,
    text: existing.text + delta,
  });
}

/**
 * Replaces the streamed text of a finished part.
 *
 * `*.ended` carries the authoritative full text, which also self-heals any
 * deltas missed while reconnecting. It is only trusted when non-empty so an
 * empty payload cannot wipe text already rendered.
 */
function finalizeStreamedPart(
  parts: ChatPart[],
  part: ChatTextPart | ChatReasoningPart,
  text: string,
): ChatPart[] {
  if (!text) {
    return parts;
  }

  const index = parts.findIndex((item) => item.id === part.id);
  if (index === -1) {
    return [...parts, { ...part, text }];
  }

  const existing = parts[index];
  if (
    !existing ||
    (existing.type !== "text" && existing.type !== "reasoning")
  ) {
    return [...parts, { ...part, text }];
  }

  return replaceAt(parts, index, { ...existing, ...part, text });
}

function findToolPart(parts: ChatPart[], id: string): ChatToolPart | undefined {
  return parts.find(
    (item): item is ChatToolPart => item.id === id && item.type === "tool",
  );
}

function upsertToolPart(parts: ChatPart[], part: ChatToolPart): ChatPart[] {
  const index = parts.findIndex((item) => item.id === part.id);
  if (index === -1) {
    return [...parts, part];
  }

  const existing = parts[index];
  if (!existing || existing.type !== "tool") {
    // A text or reasoning part already holds this id, which means the server
    // re-used an ordinal that a tool previously claimed. Replace it for the
    // same reason as `appendToStreamedPart`: appending would leave two parts
    // sharing one id, which collides as a list key and makes later lookups by
    // id resolve whichever entry happens to be first.
    return replaceAt(parts, index, part);
  }

  // Partial updates must not clear fields the event did not mention.
  return replaceAt(parts, index, {
    ...existing,
    ...part,
    metadata:
      part.metadata !== undefined
        ? { ...existing.metadata, ...part.metadata }
        : existing.metadata,
  });
}

/**
 * Builds the tool part for an event that addresses a tool by `data.id`.
 *
 * The tool name is only sent on `session.tool.input.started`, so a stream that
 * reconnects mid-tool has no name for later events. Those parts are still
 * created — an unlabelled tool beats an invisible one — using the fallback
 * name below.
 */
function toolPartSkeleton(
  id: string,
  name: string | undefined,
  created: number,
): ChatToolPart {
  return {
    id,
    type: "tool",
    tool: name ?? "tool",
    status: "streaming",
    rawInput: "",
    time: { created },
  };
}

function mergeInfo(
  info: ChatMessageInfo,
  patch: Partial<ChatMessageInfo>,
): ChatMessageInfo {
  return { ...info, ...patch };
}

// ---------------------------------------------------------------------------
// applyStreamEvent
// ---------------------------------------------------------------------------

/**
 * Folds a single V2 event into the message list.
 *
 * @returns the next list, or `null` when the event does not affect the
 * transcript (wrong session, another subsystem's event, or no-op state).
 */
export function applyStreamEvent(
  messages: ChatMessage[],
  event: V2Event,
  sessionId: string,
): ChatMessage[] | null {
  const scoped = eventSessionId(event);
  if (scoped !== undefined && scoped !== sessionId) {
    return null;
  }

  switch (event.type) {
    // -- Text ---------------------------------------------------------------
    case "session.text.started":
    case "session.text.delta": {
      const { assistantMessageID, ordinal } = event.data;
      const partId = positionalPartId(assistantMessageID, ordinal);
      const delta = event.type === "session.text.delta" ? event.data.delta : "";

      return updateMessage(
        messages,
        assistantMessageID,
        event.created,
        (message) => ({
          ...message,
          parts: appendToStreamedPart(
            message.parts,
            { id: partId, type: "text", text: "" },
            delta,
          ),
        }),
      );
    }

    case "session.text.ended": {
      const { assistantMessageID, ordinal, text } = event.data;
      const partId = positionalPartId(assistantMessageID, ordinal);

      return updateMessage(
        messages,
        assistantMessageID,
        event.created,
        (message) => ({
          ...message,
          parts: finalizeStreamedPart(
            message.parts,
            { id: partId, type: "text", text },
            text,
          ),
        }),
      );
    }

    // -- Reasoning ----------------------------------------------------------
    case "session.reasoning.started":
    case "session.reasoning.delta": {
      const { assistantMessageID, ordinal } = event.data;
      const partId = positionalPartId(assistantMessageID, ordinal);
      const delta =
        event.type === "session.reasoning.delta" ? event.data.delta : "";

      return updateMessage(
        messages,
        assistantMessageID,
        event.created,
        (message) => ({
          ...message,
          parts: appendToStreamedPart(
            message.parts,
            {
              id: partId,
              type: "reasoning",
              text: "",
              time: { created: event.created },
            },
            delta,
          ),
        }),
      );
    }

    case "session.reasoning.ended": {
      const { assistantMessageID, ordinal, text } = event.data;
      const partId = positionalPartId(assistantMessageID, ordinal);

      return updateMessage(
        messages,
        assistantMessageID,
        event.created,
        (message) => ({
          ...message,
          parts: finalizeStreamedPart(
            message.parts,
            {
              id: partId,
              type: "reasoning",
              text,
              time: { created: event.created, completed: event.created },
            },
            text,
          ),
        }),
      );
    }

    // -- Tool lifecycle -----------------------------------------------------
    case "session.tool.input.started":
    case "session.tool.input.delta":
    case "session.tool.input.ended": {
      const { assistantMessageID, id } = event.data;
      const name =
        event.type === "session.tool.input.started"
          ? event.data.name
          : undefined;

      return updateMessage(
        messages,
        assistantMessageID,
        event.created,
        (message) => {
          const skeleton =
            findToolPart(message.parts, id) ??
            toolPartSkeleton(id, name, event.created);

          let rawInput = skeleton.rawInput ?? "";
          if (event.type === "session.tool.input.delta") {
            rawInput += event.data.delta;
          } else if (event.type === "session.tool.input.ended") {
            // `ended` carries the complete raw JSON, which repairs any gaps left
            // by deltas that were dropped while reconnecting.
            rawInput = event.data.text;
          }

          return {
            ...message,
            parts: upsertToolPart(message.parts, {
              ...skeleton,
              tool: name ?? skeleton.tool,
              status: "streaming",
              rawInput,
            }),
          };
        },
      );
    }

    case "session.tool.called": {
      const { assistantMessageID, id, input } = event.data;

      return updateMessage(
        messages,
        assistantMessageID,
        event.created,
        (message) => {
          const skeleton =
            findToolPart(message.parts, id) ??
            toolPartSkeleton(id, undefined, event.created);

          return {
            ...message,
            parts: upsertToolPart(message.parts, {
              ...skeleton,
              status: "running",
              input,
              // Parsed arguments supersede the partial JSON.
              rawInput: undefined,
            }),
          };
        },
      );
    }

    case "session.tool.progress": {
      const { assistantMessageID, id, metadata } = event.data;

      return updateMessage(
        messages,
        assistantMessageID,
        event.created,
        (message) => {
          const skeleton =
            findToolPart(message.parts, id) ??
            toolPartSkeleton(id, undefined, event.created);

          return {
            ...message,
            parts: upsertToolPart(message.parts, {
              ...skeleton,
              // Progress implies the tool is executing, not still parsing args.
              status:
                skeleton.status === "streaming" ? "running" : skeleton.status,
              metadata,
            }),
          };
        },
      );
    }

    case "session.tool.success": {
      const { assistantMessageID, id, content, metadata } = event.data;

      return updateMessage(
        messages,
        assistantMessageID,
        event.created,
        (message) => {
          const skeleton =
            findToolPart(message.parts, id) ??
            toolPartSkeleton(id, undefined, event.created);

          return {
            ...message,
            parts: upsertToolPart(message.parts, {
              ...skeleton,
              status: "completed",
              content: toToolContent(content),
              error: undefined,
              rawInput: undefined,
              metadata: metadata ?? skeleton.metadata,
              time: {
                created: skeleton.time?.created ?? event.created,
                completed: event.created,
              },
            }),
          };
        },
      );
    }

    case "session.tool.failed": {
      const { assistantMessageID, id, error, content, metadata } = event.data;

      return updateMessage(
        messages,
        assistantMessageID,
        event.created,
        (message) => {
          const skeleton =
            findToolPart(message.parts, id) ??
            toolPartSkeleton(id, undefined, event.created);

          return {
            ...message,
            parts: upsertToolPart(message.parts, {
              ...skeleton,
              status: "error",
              error: error.message,
              content: content ? toToolContent(content) : skeleton.content,
              rawInput: undefined,
              metadata: metadata ?? skeleton.metadata,
              time: {
                created: skeleton.time?.created ?? event.created,
                completed: event.created,
              },
            }),
          };
        },
      );
    }

    // -- Steps --------------------------------------------------------------
    case "session.step.started": {
      const { assistantMessageID, agent, model, started } = event.data;

      // `started` is the assistant message's own timestamp, which is what
      // `updateMessage` stamps when it has to create the message lazily.
      return updateMessage(
        messages,
        assistantMessageID,
        started ?? event.created,
        (message) => ({
          ...message,
          info: mergeInfo(message.info, {
            agent,
            modelID: model.id,
            providerID: model.providerID,
          }),
        }),
      );
    }

    case "session.step.ended": {
      const { assistantMessageID, finish, cost, tokens } = event.data;

      return updateMessage(
        messages,
        assistantMessageID,
        event.created,
        (message) => ({
          ...message,
          info: mergeInfo(message.info, {
            finish,
            cost,
            tokens,
            error: undefined,
            time: { ...message.info.time, completed: event.created },
          }),
        }),
      );
    }

    case "session.step.failed": {
      const { assistantMessageID, error, finish, cost, tokens } = event.data;

      return updateMessage(
        messages,
        assistantMessageID,
        event.created,
        (message) => ({
          ...message,
          info: mergeInfo(message.info, {
            finish,
            cost,
            tokens,
            error: error.message,
            time: { ...message.info.time, completed: event.created },
          }),
        }),
      );
    }

    // -- Business / history events ------------------------------------------
    // Busy state lives in `isAgentBusyEvent`, history-changing events in
    // `shouldRefetchMessages`. Neither changes the transcript incrementally, so
    // they return `null` here rather than forcing a reducer round-trip.
    case "session.idle":
    case "session.status":
    case "session.execution.started":
    case "session.execution.succeeded":
    case "session.execution.failed":
    case "session.execution.interrupted":
    case "session.compaction.started":
    case "session.compaction.delta":
    case "session.compaction.ended":
    case "session.compaction.failed":
    case "session.revert.staged":
    case "session.revert.cleared":
    case "session.revert.committed":
      return null;

    default:
      // `session.inbox.*`, `session.created`, `session.renamed`, `session.deleted`,
      // `session.shell.*`, `session.synthetic`, `filesystem.changed`,
      // `vcs.branch.updated`, `pty.*`, `permission.*`, `form.*`, `tui.*`,
      // `installation.*`, `worktree.*`, `mcp.*`, `plugin.*`, `config.*`,
      // `command.*`, `skill.*`, `reference.*`, `websearch.*` and friends are
      // owned by other modules and do not mutate the transcript.
      return null;
  }
}

// ---------------------------------------------------------------------------
// Busy state
// ---------------------------------------------------------------------------

/**
 * Reports whether the agent is busy, idle, or the event says nothing about it.
 *
 * V1 derived "busy" from a tool part's running state, which no longer exists
 * as a single event. V2 has explicit signals instead.
 */
export function isAgentBusyEvent(event: V2Event): boolean | null {
  switch (event.type) {
    case "session.status": {
      // `retry` means the turn is still in flight, just waiting to back off.
      return event.data.status.type !== "idle";
    }

    case "session.idle":
      return false;

    case "session.execution.started":
      return true;

    case "session.execution.succeeded":
    case "session.execution.failed":
    case "session.execution.interrupted":
      return false;

    case "session.tool.called":
    case "session.tool.progress":
      // A tool is currently executing, so the agent is busy.
      return true;

    default:
      // Tool completion deliberately returns `null`: the agent usually keeps
      // working afterwards, and `session.idle` is the authoritative signal.
      return null;
  }
}

// ---------------------------------------------------------------------------
// Refetch triggers
// ---------------------------------------------------------------------------

/**
 * True when the event invalidates the cached message list.
 *
 * V1 refetched on `session.compacted`, `session.diff` and `command.executed`.
 * None of those map one-to-one in V2: compaction and reverts now mutate history
 * on the server without echoing it as a stream event, so the only reliable
 * option is to re-read the session.
 */
export function shouldRefetchMessages(event: V2Event): boolean {
  switch (event.type) {
    case "session.compaction.ended":
    case "session.compaction.failed":
    case "session.revert.staged":
    case "session.revert.cleared":
    case "session.revert.committed":
      return true;

    default:
      return false;
  }
}
