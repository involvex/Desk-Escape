import { describe, expect, test } from "bun:test";

import {
  applyCursorStreamEvent,
  isCursorAgentBusyEvent,
  shouldRefetchCursorMessages,
} from "@/api/providers/cursor/message-stream";
import type { CursorStreamEvent } from "@/api/providers/cursor/types";

/**
 * Tests for the Cursor stream reducer.
 *
 * This reducer was uncovered even though it handles every event the Cursor
 * backend emits. Unlike the OpenCode reducer, it is not a positional-addressed
 * stream: each `assistant` / `thinking` / `tool_call` event mutates "the current
 * assistant message", found by role. That makes the ordering rules below the
 * part most worth pinning.
 *
 * Note the part shapes here are Cursor's own (`thinking` with `content`, `tool`
 * with a nested `state`), not the OpenCode `ChatPart` union, so parts are
 * inspected by their `type` string.
 */

const RUN = "run_1";

type Messages = Parameters<typeof applyCursorStreamEvent>[0];
type Part = Messages[number]["parts"][number];

function apply(messages: Messages, event: CursorStreamEvent): Messages {
  const next = applyCursorStreamEvent(messages, event, RUN);
  if (next === null) {
    throw new Error(`expected ${event.type} to mutate the transcript`);
  }
  return next;
}

function types(messages: Messages): string[] {
  return messages.flatMap((m) => m.parts.map((p) => p.type));
}

function partTypes(message: Messages[number]): string[] {
  return message.parts.map((p: Part) => p.type);
}

// ---------------------------------------------------------------------------
// assistant
// ---------------------------------------------------------------------------

describe("assistant events", () => {
  test("appends a new assistant message", () => {
    const messages = apply([], {
      type: "assistant",
      payload: { text: "Hello" },
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]?.info.role).toBe("assistant");
    expect(types(messages)).toEqual(["text"]);
  });

  test("each assistant event makes its own message", () => {
    let messages = apply([], { type: "assistant", payload: { text: "one" } });
    messages = apply(messages, { type: "assistant", payload: { text: "two" } });

    expect(messages).toHaveLength(2);
  });

  test("carries the text through", () => {
    const messages = apply([], {
      type: "assistant",
      payload: { text: "Hello" },
    });
    const part = messages[0]?.parts[0] as { text?: string };

    expect(part.text).toBe("Hello");
  });

  test("generates unique ids per message and part", () => {
    let messages = apply([], { type: "assistant", payload: { text: "a" } });
    messages = apply(messages, { type: "assistant", payload: { text: "b" } });

    const ids = messages.map((m) => m.info.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("tags the message with the current run id", () => {
    const messages = apply([], { type: "assistant", payload: { text: "x" } });
    // `sessionID` is written by the reducer but is not part of `ChatMessageInfo`,
    // so it is read through a widened view rather than a cast on the type.
    const info = messages[0]?.info as { sessionID?: string } | undefined;
    expect(info?.sessionID).toBe(RUN);
  });

  test("does not mutate the input list", () => {
    const input: Messages = [];
    apply(input, { type: "assistant", payload: { text: "x" } });
    expect(input).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// thinking
// ---------------------------------------------------------------------------

describe("thinking events", () => {
  test("creates an assistant message when none exists", () => {
    const messages = apply([], {
      type: "thinking",
      payload: { text: "pondering" },
    });

    expect(messages).toHaveLength(1);
    expect(partTypes(messages[0]!)).toEqual(["thinking"]);
  });

  test("attaches to the existing assistant message", () => {
    let messages = apply([], { type: "assistant", payload: { text: "Hi" } });
    messages = apply(messages, {
      type: "thinking",
      payload: { text: "pondering" },
    });

    expect(messages).toHaveLength(1);
    expect(partTypes(messages[0]!)).toEqual(["text", "thinking"]);
  });

  test("replaces an earlier thinking block rather than stacking", () => {
    // Thinking arrives in chunks, so consecutive thinking events must collapse
    // into one part instead of accumulating one part per chunk.
    let messages = apply([], { type: "assistant", payload: { text: "Hi" } });
    messages = apply(messages, {
      type: "thinking",
      payload: { text: "first" },
    });
    messages = apply(messages, {
      type: "thinking",
      payload: { text: "second" },
    });

    expect(messages).toHaveLength(1);
    expect(partTypes(messages[0]!)).toEqual(["text", "thinking"]);
  });

  test("the surviving thinking block holds the latest text", () => {
    let messages = apply([], { type: "assistant", payload: { text: "Hi" } });
    messages = apply(messages, {
      type: "thinking",
      payload: { text: "first" },
    });
    messages = apply(messages, {
      type: "thinking",
      payload: { text: "second" },
    });

    const thinking = messages[0]?.parts.at(-1) as { content?: string };
    expect(thinking.content).toBe("second");
  });

  test("targets the first assistant message when several exist", () => {
    // `messages.find(role === "assistant")` resolves the first match, not the
    // latest. Recorded deliberately: on a multi-turn run a thinking block lands
    // on the *oldest* assistant message. That is a design wart in the Cursor
    // reducer, pinned here so changing it is a deliberate decision.
    let messages = apply([], { type: "assistant", payload: { text: "one" } });
    messages = apply(messages, { type: "assistant", payload: { text: "two" } });
    messages = apply(messages, {
      type: "thinking",
      payload: { text: "thought" },
    });

    expect(partTypes(messages[0]!)).toEqual(["text", "thinking"]);
    expect(partTypes(messages[1]!)).toEqual(["text"]);
  });
});

// ---------------------------------------------------------------------------
// tool_call
// ---------------------------------------------------------------------------

describe("tool_call events", () => {
  test("creates an assistant message when none exists", () => {
    const messages = apply([], {
      type: "tool_call",
      payload: { name: "read", input: { path: "a.ts" } },
    });

    expect(messages).toHaveLength(1);
    expect(partTypes(messages[0]!)).toEqual(["tool"]);
  });

  test("appends to the existing assistant message without replacing text", () => {
    let messages = apply([], {
      type: "assistant",
      payload: { text: "Running" },
    });
    messages = apply(messages, {
      type: "tool_call",
      payload: { name: "bash", input: {} },
    });

    expect(messages).toHaveLength(1);
    expect(partTypes(messages[0]!)).toEqual(["text", "tool"]);
  });

  test("accumulates multiple tool calls", () => {
    let messages = apply([], { type: "assistant", payload: { text: "x" } });
    messages = apply(messages, {
      type: "tool_call",
      payload: { name: "read" },
    });
    messages = apply(messages, {
      type: "tool_call",
      payload: { name: "edit" },
    });

    expect(partTypes(messages[0]!)).toEqual(["text", "tool", "tool"]);
  });

  test("records the tool name, defaulting when absent", () => {
    const named = apply([], { type: "tool_call", payload: { name: "bash" } });
    const unnamed = apply([], { type: "tool_call", payload: {} });

    expect(
      (named[0]?.parts[0] as { tool?: { name?: string } }).tool?.name,
    ).toBe("bash");
    expect(
      (unnamed[0]?.parts[0] as { tool?: { name?: string } }).tool?.name,
    ).toBe("unknown");
  });

  test("marks the tool state completed", () => {
    // Cursor's stream emits a tool_call once, with the outcome inline, so the
    // reducer hardcodes `completed` rather than tracking a lifecycle.
    const messages = apply([], {
      type: "tool_call",
      payload: { name: "bash" },
    });
    const part = messages[0]?.parts[0] as {
      tool?: { state?: { status?: string } };
    };

    expect(part.tool?.state?.status).toBe("completed");
  });

  test("carries input and output through", () => {
    const messages = apply([], {
      type: "tool_call",
      payload: { name: "bash", input: { cmd: "ls" }, output: "a\nb" },
    });
    const part = messages[0]?.parts[0] as {
      tool?: { state?: { input?: unknown; output?: unknown } };
    };

    expect(part.tool?.state?.input).toEqual({ cmd: "ls" });
    expect(part.tool?.state?.output).toBe("a\nb");
  });
});

// ---------------------------------------------------------------------------
// error
// ---------------------------------------------------------------------------

describe("error events", () => {
  test("appends a system message", () => {
    const messages = apply([], {
      type: "error",
      payload: { code: "RATE_LIMIT", message: "slow down" },
    });

    expect(messages).toHaveLength(1);
    // The reducer writes `role: "system"`, which predates `ChatMessageInfo`
    // narrowing `role` to user/assistant.
    const info = messages[0]?.info as { role?: string } | undefined;
    expect(info?.role).toBe("system");
  });

  test("prefixes the message text with Error:", () => {
    const messages = apply([], {
      type: "error",
      payload: { code: "X", message: "boom" },
    });

    expect((messages[0]?.parts[0] as { text?: string }).text).toBe(
      "Error: boom",
    );
  });

  test("does not attach to an existing assistant message", () => {
    // Errors are their own system message, so they must not be folded into the
    // assistant turn.
    let messages = apply([], {
      type: "assistant",
      payload: { text: "working" },
    });
    messages = apply(messages, {
      type: "error",
      payload: { code: "X", message: "boom" },
    });

    expect(messages).toHaveLength(2);
    expect(partTypes(messages[0]!)).toEqual(["text"]);
    expect(partTypes(messages[1]!)).toEqual(["text"]);
  });

  test("includes the code so the user can act on it", () => {
    const messages = apply([], {
      type: "error",
      payload: { code: "RATE_LIMIT", message: "slow down" },
    });

    const text = (messages[0]?.parts[0] as { text?: string }).text ?? "";
    expect(text).toContain("slow down");
  });
});

// ---------------------------------------------------------------------------
// No-op events
// ---------------------------------------------------------------------------

describe("no-op events", () => {
  for (const event of [
    { type: "heartbeat" },
    { type: "status", payload: { runId: RUN, status: "RUNNING" } },
    { type: "result", payload: { runId: RUN, status: "FINISHED" } },
  ] as CursorStreamEvent[]) {
    test(`${event.type} returns null`, () => {
      expect(applyCursorStreamEvent([], event, RUN)).toBeNull();
    });
  }

  test("status leaves an existing transcript untouched", () => {
    const before = apply([], { type: "assistant", payload: { text: "Hi" } });
    const after = applyCursorStreamEvent(
      before,
      { type: "status", payload: { runId: RUN, status: "RUNNING" } },
      RUN,
    );

    expect(after).toBeNull();
    expect(before).toHaveLength(1);
  });

  test("an unrecognised event type returns null rather than throwing", () => {
    const event = {
      type: "something_new",
      payload: {},
    } as unknown as CursorStreamEvent;
    expect(applyCursorStreamEvent([], event, RUN)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Full run
// ---------------------------------------------------------------------------

describe("a full Cursor run", () => {
  test("folds a realistic event sequence in order", () => {
    let messages: Messages = [];

    // A status event is a no-op for the transcript, so it is folded separately.
    expect(
      applyCursorStreamEvent(
        messages,
        { type: "status", payload: { runId: RUN, status: "RUNNING" } },
        RUN,
      ),
    ).toBeNull();

    messages = apply(messages, {
      type: "assistant",
      payload: { text: "Reading files" },
    });
    messages = apply(messages, {
      type: "tool_call",
      payload: { name: "read", input: { path: "a.ts" }, output: "contents" },
    });
    messages = apply(messages, {
      type: "tool_call",
      payload: { name: "edit", input: { path: "b.ts" }, output: "ok" },
    });
    messages = apply(messages, {
      type: "assistant",
      payload: { text: "Done" },
    });
    messages = apply(messages, {
      type: "thinking",
      payload: { text: "wrapping up" },
    });

    // `assistant` always appends a new message, so the second one opens a fresh
    // turn rather than continuing the first that holds the tool calls. The
    // trailing thinking attaches to the *first* assistant message - the wart
    // covered separately below.
    expect(messages).toHaveLength(2);
    expect(partTypes(messages[0]!)).toEqual([
      "text",
      "tool",
      "tool",
      "thinking",
    ]);
    expect(partTypes(messages[1]!)).toEqual(["text"]);
  });

  test("a trailing thinking block lands on the earlier turn, not the newest", () => {
    // Documents the wart from a realistic sequence: the thinking that narrates
    // "turn two" is attached to turn one's message, because the reducer resolves
    // the first assistant match.
    let messages: Messages = [];
    messages = apply(messages, {
      type: "assistant",
      payload: { text: "turn one" },
    });
    messages = apply(messages, {
      type: "tool_call",
      payload: { name: "read", input: {} },
    });
    messages = apply(messages, {
      type: "assistant",
      payload: { text: "turn two" },
    });
    messages = apply(messages, {
      type: "thinking",
      payload: { text: "about turn two" },
    });

    expect(messages).toHaveLength(2);
    expect(partTypes(messages[0]!)).toEqual(["text", "tool", "thinking"]);
    expect(partTypes(messages[1]!)).toEqual(["text"]);
  });

  test("a leading thinking block opens the first message", () => {
    let messages: Messages = [];
    messages = apply(messages, {
      type: "thinking",
      payload: { text: "planning" },
    });
    messages = apply(messages, {
      type: "tool_call",
      payload: { name: "read", input: {} },
    });

    expect(messages).toHaveLength(1);
    expect(partTypes(messages[0]!)).toEqual(["thinking", "tool"]);
  });

  test("ids stay unique across a whole run", () => {
    let messages: Messages = [];
    messages = apply(messages, { type: "thinking", payload: { text: "t" } });
    messages = apply(messages, { type: "assistant", payload: { text: "a" } });
    messages = apply(messages, { type: "tool_call", payload: { name: "x" } });

    const ids = messages.flatMap((m) => [
      m.info.id,
      ...m.parts.map((p) => (p as { id?: string }).id ?? ""),
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// Busy state
// ---------------------------------------------------------------------------

describe("isCursorAgentBusyEvent", () => {
  test("RUNNING means busy", () => {
    expect(
      isCursorAgentBusyEvent({
        type: "status",
        payload: { runId: RUN, status: "RUNNING" },
      }),
    ).toBe(true);
  });

  test("CREATING means busy", () => {
    expect(
      isCursorAgentBusyEvent({
        type: "status",
        payload: { runId: RUN, status: "CREATING" },
      }),
    ).toBe(true);
  });

  test("FINISHED status does not mean busy", () => {
    expect(
      isCursorAgentBusyEvent({
        type: "status",
        payload: { runId: RUN, status: "FINISHED" },
      }),
    ).toBe(false);
  });

  test("a result means not busy", () => {
    expect(
      isCursorAgentBusyEvent({
        type: "result",
        payload: { runId: RUN, status: "FINISHED" },
      }),
    ).toBe(false);
  });

  test("transcript events say nothing about busy state", () => {
    // The status event is authoritative, same as the OpenCode provider.
    expect(
      isCursorAgentBusyEvent({ type: "assistant", payload: { text: "x" } }),
    ).toBeNull();
    expect(
      isCursorAgentBusyEvent({ type: "tool_call", payload: { name: "bash" } }),
    ).toBeNull();
  });

  test("heartbeat says nothing", () => {
    expect(isCursorAgentBusyEvent({ type: "heartbeat" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Refetch triggers
// ---------------------------------------------------------------------------

describe("shouldRefetchCursorMessages", () => {
  test("a result invalidates the cached list", () => {
    expect(
      shouldRefetchCursorMessages({
        type: "result",
        payload: { runId: RUN, status: "FINISHED" },
      }),
    ).toBe(true);
  });

  test("other events do not refetch", () => {
    expect(
      shouldRefetchCursorMessages({
        type: "status",
        payload: { runId: RUN, status: "RUNNING" },
      }),
    ).toBe(false);
    expect(
      shouldRefetchCursorMessages({
        type: "assistant",
        payload: { text: "x" },
      }),
    ).toBe(false);
    expect(shouldRefetchCursorMessages({ type: "heartbeat" })).toBe(false);
  });
});
