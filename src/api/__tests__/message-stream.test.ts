import { describe, expect, test } from "bun:test";

import {
  applyStreamEvent,
  isAgentBusyEvent,
  shouldRefetchMessages,
} from "@/api/message-stream";
import { positionalPartId } from "@/api/opencode/adapter";
import type {
  ChatMessage,
  ChatReasoningPart,
  ChatTextPart,
  ChatToolPart,
} from "@/types/domain";

/**
 * Tests for the V2 event reducer.
 *
 * The reducer is the highest-risk pure function in the app: ~350 lines of event
 * folding that has no test coverage, where a regression silently corrupts the
 * transcript rather than throwing. These tests pin the behaviour that is easy
 * to break and expensive to notice.
 *
 * The event fixtures are deliberately narrow objects cast through `V2Event`.
 * Asserting against the SDK's full union would make these tests fail on any
 * SDK upgrade that merely *adds* a field, which is not a behaviour change.
 */

const SESSION = "ses_test";
const OTHER_SESSION = "ses_other";
const MSG = "msg_1";

type AnyEvent = Parameters<typeof applyStreamEvent>[1];

function ev(type: string, data: Record<string, unknown>, created = 1000) {
  return {
    type,
    data: { sessionID: SESSION, ...data },
    created,
  } as unknown as AnyEvent;
}

/** An empty transcript. */
const empty = (): ChatMessage[] => [];

/** A user message, to prove the reducer never touches user entries. */
const withUserMessage = (): ChatMessage[] => [
  {
    info: {
      id: "msg_user",
      role: "user",
      kind: "user",
      time: { created: 900 },
    },
    parts: [{ id: "msg_user:0", type: "text", text: "hello" }],
  },
];

function textPart(message: ChatMessage, ordinal: number): ChatTextPart {
  const part = message.parts.find(
    (p) => p.id === positionalPartId(MSG, ordinal),
  );
  if (!part || part.type !== "text") {
    throw new Error(`no text part at ordinal ${ordinal}`);
  }
  return part;
}

function reasoningPart(
  message: ChatMessage,
  ordinal: number,
): ChatReasoningPart {
  const part = message.parts.find(
    (p) => p.id === positionalPartId(MSG, ordinal),
  );
  if (!part || part.type !== "reasoning") {
    throw new Error(`no reasoning part at ordinal ${ordinal}`);
  }
  return part;
}

function toolPart(message: ChatMessage, id: string): ChatToolPart {
  const part = message.parts.find((p) => p.id === id && p.type === "tool");
  if (!part || part.type !== "tool") {
    throw new Error(`no tool part with id ${id}`);
  }
  return part;
}

/** Applies an event and asserts it produced a list (rather than `null`). */
function apply(messages: ChatMessage[], event: AnyEvent): ChatMessage[] {
  const next = applyStreamEvent(messages, event, SESSION);
  if (next === null) {
    throw new Error(`expected ${event.type} to update the transcript`);
  }
  return next;
}

// ---------------------------------------------------------------------------
// Session scoping
// ---------------------------------------------------------------------------

describe("session scoping", () => {
  test("ignores an event addressed to a different session", () => {
    const event = {
      type: "session.text.delta",
      data: {
        sessionID: OTHER_SESSION,
        assistantMessageID: MSG,
        ordinal: 0,
        delta: "leak",
      },
      created: 1000,
    } as unknown as AnyEvent;

    expect(applyStreamEvent(withUserMessage(), event, SESSION)).toBeNull();
  });

  test("applies an event whose data carries no session id", () => {
    // `eventSessionId` returns undefined when `sessionID` is absent, which the
    // reducer treats as "not scoped" and therefore accepts.
    const event = {
      type: "session.idle",
      data: {},
      created: 1000,
    } as unknown as AnyEvent;

    // `session.idle` is a no-op for the transcript, so this is a stronger test
    // of the "unscoped" path than it looks: it must not be rejected early.
    expect(applyStreamEvent(empty(), event, SESSION)).toBeNull();
  });

  test("never mutates the input list", () => {
    const input = empty();
    apply(
      input,
      ev("session.text.delta", {
        assistantMessageID: MSG,
        ordinal: 0,
        delta: "hi",
      }),
    );
    expect(input).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Lazy message creation
// ---------------------------------------------------------------------------

describe("lazy message creation", () => {
  test("creates the assistant message when the stream has not produced one", () => {
    const next = apply(
      empty(),
      ev("session.text.delta", {
        assistantMessageID: MSG,
        ordinal: 0,
        delta: "hi",
      }),
    );

    expect(next).toHaveLength(1);
    expect(next[0]?.info.id).toBe(MSG);
    expect(next[0]?.info.role).toBe("assistant");
    expect(next[0]?.info.kind).toBe("assistant");
  });

  test("stamps the message with the event's created time", () => {
    const next = apply(
      empty(),
      ev(
        "session.text.delta",
        { assistantMessageID: MSG, ordinal: 0, delta: "hi" },
        4242,
      ),
    );

    expect(next[0]?.info.time.created).toBe(4242);
  });

  test("appends to an existing message rather than duplicating it", () => {
    let messages = empty();
    messages = apply(
      messages,
      ev("session.text.delta", {
        assistantMessageID: MSG,
        ordinal: 0,
        delta: "a",
      }),
    );
    messages = apply(
      messages,
      ev("session.text.delta", {
        assistantMessageID: MSG,
        ordinal: 0,
        delta: "b",
      }),
    );

    expect(messages).toHaveLength(1);
    expect(textPart(messages[0]!, 0).text).toBe("ab");
  });

  test("does not reorder or disturb other messages", () => {
    let messages = withUserMessage();
    messages = apply(
      messages,
      ev("session.text.delta", {
        assistantMessageID: MSG,
        ordinal: 0,
        delta: "a",
      }),
    );

    expect(messages.map((m) => m.info.id)).toEqual(["msg_user", MSG]);
  });
});

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

describe("text streaming", () => {
  test("accumulates deltas into one part", () => {
    let messages = empty();
    messages = apply(
      messages,
      ev("session.text.started", { assistantMessageID: MSG, ordinal: 0 }),
    );
    messages = apply(
      messages,
      ev("session.text.delta", {
        assistantMessageID: MSG,
        ordinal: 0,
        delta: "Hello ",
      }),
    );
    messages = apply(
      messages,
      ev("session.text.delta", {
        assistantMessageID: MSG,
        ordinal: 0,
        delta: "world",
      }),
    );

    expect(textPart(messages[0]!, 0).text).toBe("Hello world");
  });

  test("`started` alone creates an empty part", () => {
    const next = apply(
      empty(),
      ev("session.text.started", { assistantMessageID: MSG, ordinal: 0 }),
    );
    expect(textPart(next[0]!, 0).text).toBe("");
  });

  test("separate ordinals become separate parts", () => {
    let messages = empty();
    messages = apply(
      messages,
      ev("session.text.delta", {
        assistantMessageID: MSG,
        ordinal: 0,
        delta: "first",
      }),
    );
    messages = apply(
      messages,
      ev("session.text.delta", {
        assistantMessageID: MSG,
        ordinal: 1,
        delta: "second",
      }),
    );

    expect(textPart(messages[0]!, 0).text).toBe("first");
    expect(textPart(messages[0]!, 1).text).toBe("second");
  });

  test("part id is derived as <messageID>:<ordinal>", () => {
    const next = apply(
      empty(),
      ev("session.text.delta", {
        assistantMessageID: MSG,
        ordinal: 3,
        delta: "x",
      }),
    );
    expect(next[0]?.parts[0]?.id).toBe("msg_1:3");
  });

  test("a delta without its `started` event still creates the part", () => {
    // This is the reconnect-mid-part path: the reducer must not require a
    // matching `started`, or mid-stream reconnects lose text.
    const next = apply(
      empty(),
      ev("session.text.delta", {
        assistantMessageID: MSG,
        ordinal: 0,
        delta: "late",
      }),
    );
    expect(textPart(next[0]!, 0).text).toBe("late");
  });

  test("`ended` sets the authoritative text", () => {
    let messages = empty();
    messages = apply(
      messages,
      ev("session.text.delta", {
        assistantMessageID: MSG,
        ordinal: 0,
        delta: "par",
      }),
    );
    messages = apply(
      messages,
      ev("session.text.ended", {
        assistantMessageID: MSG,
        ordinal: 0,
        text: "partial repaired",
      }),
    );

    expect(textPart(messages[0]!, 0).text).toBe("partial repaired");
  });

  test("`ended` repairs text that was never streamed", () => {
    const next = apply(
      empty(),
      ev("session.text.ended", {
        assistantMessageID: MSG,
        ordinal: 0,
        text: "only seen at end",
      }),
    );
    expect(textPart(next[0]!, 0).text).toBe("only seen at end");
  });

  test("an empty `ended` does not wipe streamed text", () => {
    // Guards the documented self-healing rule: an empty payload must never
    // truncate what the user is already looking at.
    let messages = empty();
    messages = apply(
      messages,
      ev("session.text.delta", {
        assistantMessageID: MSG,
        ordinal: 0,
        delta: "keep me",
      }),
    );
    messages = apply(
      messages,
      ev("session.text.ended", {
        assistantMessageID: MSG,
        ordinal: 0,
        text: "",
      }),
    );

    expect(textPart(messages[0]!, 0).text).toBe("keep me");
  });
});

// ---------------------------------------------------------------------------
// Reasoning
// ---------------------------------------------------------------------------

describe("reasoning streaming", () => {
  test("accumulates reasoning deltas independently of text", () => {
    let messages = empty();
    messages = apply(
      messages,
      ev("session.text.delta", {
        assistantMessageID: MSG,
        ordinal: 0,
        delta: "answer",
      }),
    );
    messages = apply(
      messages,
      ev("session.reasoning.delta", {
        assistantMessageID: MSG,
        ordinal: 1,
        delta: "thinking",
      }),
    );

    expect(reasoningPart(messages[0]!, 1).text).toBe("thinking");
    expect(textPart(messages[0]!, 0).text).toBe("answer");
  });

  test("`ended` stamps completed time on the reasoning part", () => {
    let messages = empty();
    messages = apply(
      messages,
      ev(
        "session.reasoning.started",
        { assistantMessageID: MSG, ordinal: 0 },
        100,
      ),
    );
    messages = apply(
      messages,
      ev(
        "session.reasoning.ended",
        { assistantMessageID: MSG, ordinal: 0, text: "done" },
        250,
      ),
    );

    expect(reasoningPart(messages[0]!, 0).time?.completed).toBe(250);
  });

  test("an empty reasoning `ended` preserves streamed text", () => {
    let messages = empty();
    messages = apply(
      messages,
      ev("session.reasoning.delta", {
        assistantMessageID: MSG,
        ordinal: 0,
        delta: "partial",
      }),
    );
    messages = apply(
      messages,
      ev("session.reasoning.ended", {
        assistantMessageID: MSG,
        ordinal: 0,
        text: "",
      }),
    );

    expect(reasoningPart(messages[0]!, 0).text).toBe("partial");
  });
});

// ---------------------------------------------------------------------------
// Ordinal collision
// ---------------------------------------------------------------------------

describe("ordinal collision", () => {
  test("a text part displaces a tool occupying the same id", () => {
    // The server's ordinal wins: the stale tool is replaced, not kept
    // alongside. Appending used to leave two parts sharing one id, which
    // collided as a list key and made later lookups resolve the stale entry.
    let messages = empty();
    const id = positionalPartId(MSG, 0);
    messages = apply(
      messages,
      ev("session.tool.success", {
        assistantMessageID: MSG,
        id,
        content: [],
      }),
    );
    expect(toolPart(messages[0]!, id).status).toBe("completed");

    messages = apply(
      messages,
      ev("session.text.delta", {
        assistantMessageID: MSG,
        ordinal: 0,
        delta: "text",
      }),
    );

    const parts = messages[0]!.parts;
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ id, type: "text", text: "text" });
  });

  test("the colliding delta is applied rather than dropped", () => {
    let messages = empty();
    const id = positionalPartId(MSG, 0);
    messages = apply(
      messages,
      ev("session.tool.success", { assistantMessageID: MSG, id, content: [] }),
    );
    messages = apply(
      messages,
      ev("session.text.delta", {
        assistantMessageID: MSG,
        ordinal: 0,
        delta: "kept",
      }),
    );

    expect(textPart(messages[0]!, 0).text).toBe("kept");
  });

  test("later deltas accumulate into the replacement, not new parts", () => {
    let messages = empty();
    const id = positionalPartId(MSG, 0);
    messages = apply(
      messages,
      ev("session.tool.success", { assistantMessageID: MSG, id, content: [] }),
    );
    for (const chunk of ["a", "b", "c"]) {
      messages = apply(
        messages,
        ev("session.text.delta", {
          assistantMessageID: MSG,
          ordinal: 0,
          delta: chunk,
        }),
      );
    }

    const parts = messages[0]!.parts;
    expect(parts).toHaveLength(1);
    expect(textPart(messages[0]!, 0).text).toBe("abc");
  });

  test("ids stay unique across a collision", () => {
    let messages = empty();
    const id = positionalPartId(MSG, 0);
    messages = apply(
      messages,
      ev("session.tool.success", { assistantMessageID: MSG, id, content: [] }),
    );
    messages = apply(
      messages,
      ev("session.text.delta", {
        assistantMessageID: MSG,
        ordinal: 0,
        delta: "x",
      }),
    );

    const ids = messages[0]!.parts.map((p) => p.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  test("an authoritative `ended` still wins after a collision", () => {
    let messages = empty();
    const id = positionalPartId(MSG, 0);
    messages = apply(
      messages,
      ev("session.tool.success", { assistantMessageID: MSG, id, content: [] }),
    );
    messages = apply(
      messages,
      ev("session.text.delta", {
        assistantMessageID: MSG,
        ordinal: 0,
        delta: "par",
      }),
    );
    messages = apply(
      messages,
      ev("session.text.ended", {
        assistantMessageID: MSG,
        ordinal: 0,
        text: "repaired",
      }),
    );

    expect(messages[0]!.parts).toHaveLength(1);
    expect(textPart(messages[0]!, 0).text).toBe("repaired");
  });

  test("a reasoning part displaces a tool at the same ordinal", () => {
    let messages = empty();
    const id = positionalPartId(MSG, 0);
    messages = apply(
      messages,
      ev("session.tool.success", { assistantMessageID: MSG, id, content: [] }),
    );
    messages = apply(
      messages,
      ev("session.reasoning.delta", {
        assistantMessageID: MSG,
        ordinal: 0,
        delta: "thought",
      }),
    );

    expect(messages[0]!.parts).toHaveLength(1);
    expect(reasoningPart(messages[0]!, 0).text).toBe("thought");
  });

  test("text streamed first survives a later tool at the same id", () => {
    // In realistic V2 ordering the text part holds the ordinal first, so a tool
    // event carrying the same id must not destroy text that already landed.
    // `upsertToolPart` has its own collision guard, so this documents the pair.
    let messages = empty();
    const id = positionalPartId(MSG, 0);

    messages = apply(
      messages,
      ev("session.text.delta", {
        assistantMessageID: MSG,
        ordinal: 0,
        delta: "Real answer",
      }),
    );
    messages = apply(
      messages,
      ev("session.tool.input.started", {
        assistantMessageID: MSG,
        id,
        name: "bash",
      }),
    );

    const ids = messages[0]!.parts.map((p) => p.id);
    expect(ids.length).toBe(new Set(ids).size);

    // The tool replaces the stale text, matching the server's ordinal.
    expect(messages[0]!.parts).toHaveLength(1);
    expect(toolPart(messages[0]!, id).tool).toBe("bash");
  });

  test("a tool displacing a text part applies its own fields", () => {
    let messages = empty();
    const id = positionalPartId(MSG, 0);
    messages = apply(
      messages,
      ev("session.text.delta", {
        assistantMessageID: MSG,
        ordinal: 0,
        delta: "stale",
      }),
    );
    messages = apply(
      messages,
      ev("session.tool.success", { assistantMessageID: MSG, id, content: [] }),
    );

    const parts = messages[0]!.parts;
    expect(parts).toHaveLength(1);
    expect(parts[0]?.type).toBe("tool");
    expect(parts.some((p) => p.type === "text")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tool lifecycle
// ---------------------------------------------------------------------------

describe("tool input streaming", () => {
  const TOOL = "tool_1";

  test("`started` creates the part with the tool name and streaming status", () => {
    const next = apply(
      empty(),
      ev("session.tool.input.started", {
        assistantMessageID: MSG,
        id: TOOL,
        name: "bash",
      }),
    );
    const part = toolPart(next[0]!, TOOL);

    expect(part.tool).toBe("bash");
    expect(part.status).toBe("streaming");
    expect(part.rawInput).toBe("");
  });

  test("deltas accumulate raw JSON", () => {
    let messages = empty();
    messages = apply(
      messages,
      ev("session.tool.input.started", {
        assistantMessageID: MSG,
        id: TOOL,
        name: "bash",
      }),
    );
    messages = apply(
      messages,
      ev("session.tool.input.delta", {
        assistantMessageID: MSG,
        id: TOOL,
        delta: '{"cmd":',
      }),
    );
    messages = apply(
      messages,
      ev("session.tool.input.delta", {
        assistantMessageID: MSG,
        id: TOOL,
        delta: '"ls"}',
      }),
    );

    expect(toolPart(messages[0]!, TOOL).rawInput).toBe('{"cmd":"ls"}');
  });

  test("`ended` replaces raw JSON with the authoritative text", () => {
    let messages = empty();
    messages = apply(
      messages,
      ev("session.tool.input.started", {
        assistantMessageID: MSG,
        id: TOOL,
        name: "bash",
      }),
    );
    messages = apply(
      messages,
      ev("session.tool.input.delta", {
        assistantMessageID: MSG,
        id: TOOL,
        delta: '{"partial',
      }),
    );
    messages = apply(
      messages,
      ev("session.tool.input.ended", {
        assistantMessageID: MSG,
        id: TOOL,
        text: '{"complete":1}',
      }),
    );

    expect(toolPart(messages[0]!, TOOL).rawInput).toBe('{"complete":1}');
  });

  test("a delta with no `started` falls back to a generic tool name", () => {
    // Reconnect-mid-tool path: the name was only ever sent on `started`.
    const next = apply(
      empty(),
      ev("session.tool.input.delta", {
        assistantMessageID: MSG,
        id: TOOL,
        delta: "{",
      }),
    );
    expect(toolPart(next[0]!, TOOL).tool).toBe("tool");
  });

  test("a later `started` names a part created earlier by a delta", () => {
    let messages = empty();
    messages = apply(
      messages,
      ev("session.tool.input.delta", {
        assistantMessageID: MSG,
        id: TOOL,
        delta: "{",
      }),
    );
    messages = apply(
      messages,
      ev("session.tool.input.started", {
        assistantMessageID: MSG,
        id: TOOL,
        name: "edit",
      }),
    );

    expect(toolPart(messages[0]!, TOOL).tool).toBe("edit");
  });
});

describe("tool called", () => {
  const TOOL = "tool_1";

  test("stores parsed input and clears the partial JSON", () => {
    let messages = empty();
    messages = apply(
      messages,
      ev("session.tool.input.started", {
        assistantMessageID: MSG,
        id: TOOL,
        name: "bash",
      }),
    );
    messages = apply(
      messages,
      ev("session.tool.input.delta", {
        assistantMessageID: MSG,
        id: TOOL,
        delta: '{"cmd"',
      }),
    );
    messages = apply(
      messages,
      ev("session.tool.called", {
        assistantMessageID: MSG,
        id: TOOL,
        input: { cmd: "ls" },
      }),
    );

    const part = toolPart(messages[0]!, TOOL);
    expect(part.status).toBe("running");
    expect(part.input).toEqual({ cmd: "ls" });
    expect(part.rawInput).toBeUndefined();
  });
});

describe("tool progress", () => {
  const TOOL = "tool_1";

  test("promotes a streaming part to running", () => {
    let messages = empty();
    messages = apply(
      messages,
      ev("session.tool.input.started", {
        assistantMessageID: MSG,
        id: TOOL,
        name: "bash",
      }),
    );
    messages = apply(
      messages,
      ev("session.tool.progress", {
        assistantMessageID: MSG,
        id: TOOL,
        metadata: { pct: 50 },
      }),
    );

    const part = toolPart(messages[0]!, TOOL);
    expect(part.status).toBe("running");
    expect(part.metadata).toEqual({ pct: 50 });
  });

  test("does not demote an already-completed tool", () => {
    let messages = empty();
    messages = apply(
      messages,
      ev("session.tool.success", {
        assistantMessageID: MSG,
        id: TOOL,
        content: [],
      }),
    );
    messages = apply(
      messages,
      ev("session.tool.progress", {
        assistantMessageID: MSG,
        id: TOOL,
        metadata: {},
      }),
    );

    expect(toolPart(messages[0]!, TOOL).status).toBe("completed");
  });
});

describe("tool success", () => {
  const TOOL = "tool_1";

  test("marks completed and records content", () => {
    const next = apply(
      empty(),
      ev("session.tool.success", {
        assistantMessageID: MSG,
        id: TOOL,
        content: [{ type: "text", text: "total 0" }],
      }),
    );
    const part = toolPart(next[0]!, TOOL);

    expect(part.status).toBe("completed");
    expect(part.content).toEqual([{ type: "text", text: "total 0" }]);
    expect(part.time?.completed).toBe(1000);
  });

  test("maps file content entries to the file variant", () => {
    const next = apply(
      empty(),
      ev("session.tool.success", {
        assistantMessageID: MSG,
        id: TOOL,
        content: [
          {
            type: "file",
            uri: "file:///a.png",
            mime: "image/png",
            name: "a.png",
          },
        ],
      }),
    );

    expect(toolPart(next[0]!, TOOL).content).toEqual([
      { type: "file", uri: "file:///a.png", mime: "image/png", name: "a.png" },
    ]);
  });

  test("tolerates a null name on file content", () => {
    const next = apply(
      empty(),
      ev("session.tool.success", {
        assistantMessageID: MSG,
        id: TOOL,
        content: [{ type: "file", uri: "file:///x", mime: "image/png" }],
      }),
    );

    expect(toolPart(next[0]!, TOOL).content?.[0]).toEqual({
      type: "file",
      uri: "file:///x",
      mime: "image/png",
      name: null,
    });
  });

  test("clears a prior error", () => {
    let messages = empty();
    messages = apply(
      messages,
      ev("session.tool.failed", {
        assistantMessageID: MSG,
        id: TOOL,
        error: { message: "boom" },
        content: [],
      }),
    );
    expect(toolPart(messages[0]!, TOOL).error).toBe("boom");

    messages = apply(
      messages,
      ev("session.tool.success", {
        assistantMessageID: MSG,
        id: TOOL,
        content: [],
      }),
    );
    expect(toolPart(messages[0]!, TOOL).error).toBeUndefined();
  });

  test("keeps the original created time across completion", () => {
    let messages = empty();
    messages = apply(
      messages,
      ev(
        "session.tool.input.started",
        { assistantMessageID: MSG, id: TOOL, name: "bash" },
        500,
      ),
    );
    messages = apply(
      messages,
      ev(
        "session.tool.success",
        { assistantMessageID: MSG, id: TOOL, content: [] },
        900,
      ),
    );

    expect(toolPart(messages[0]!, TOOL).time?.created).toBe(500);
    expect(toolPart(messages[0]!, TOOL).time?.completed).toBe(900);
  });
});

describe("tool failure", () => {
  const TOOL = "tool_1";

  test("marks error and records the message", () => {
    const next = apply(
      empty(),
      ev("session.tool.failed", {
        assistantMessageID: MSG,
        id: TOOL,
        error: { message: "exit 1" },
        content: [{ type: "text", text: "stderr" }],
      }),
    );
    const part = toolPart(next[0]!, TOOL);

    expect(part.status).toBe("error");
    expect(part.error).toBe("exit 1");
    expect(part.content).toEqual([{ type: "text", text: "stderr" }]);
  });

  test("preserves earlier content when failure carries none", () => {
    let messages = empty();
    messages = apply(
      messages,
      ev("session.tool.success", {
        assistantMessageID: MSG,
        id: TOOL,
        content: [{ type: "text", text: "partial output" }],
      }),
    );
    messages = apply(
      messages,
      ev("session.tool.failed", {
        assistantMessageID: MSG,
        id: TOOL,
        error: { message: "timeout" },
      }),
    );

    expect(toolPart(messages[0]!, TOOL).content).toEqual([
      { type: "text", text: "partial output" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

describe("step events", () => {
  test("`started` records agent, model and provider", () => {
    const next = apply(
      empty(),
      ev("session.step.started", {
        assistantMessageID: MSG,
        agent: "build",
        model: { id: "claude-sonnet-5", providerID: "anthropic" },
        started: 700,
      }),
    );

    expect(next[0]?.info.agent).toBe("build");
    expect(next[0]?.info.modelID).toBe("claude-sonnet-5");
    expect(next[0]?.info.providerID).toBe("anthropic");
  });

  test("`started` uses the step's own timestamp when provided", () => {
    const next = apply(
      empty(),
      ev(
        "session.step.started",
        {
          assistantMessageID: MSG,
          agent: "build",
          model: { id: "m", providerID: "p" },
          started: 700,
        },
        1000,
      ),
    );

    expect(next[0]?.info.time.created).toBe(700);
  });

  test("`ended` records finish, cost and tokens and stamps completion", () => {
    let messages = empty();
    messages = apply(
      messages,
      ev("session.step.started", {
        assistantMessageID: MSG,
        agent: "build",
        model: { id: "m", providerID: "p" },
        started: 700,
      }),
    );
    messages = apply(
      messages,
      ev(
        "session.step.ended",
        {
          assistantMessageID: MSG,
          finish: "stop",
          cost: 0.0123,
          tokens: {
            input: 10,
            output: 20,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        },
        1200,
      ),
    );

    expect(messages[0]?.info.finish).toBe("stop");
    expect(messages[0]?.info.cost).toBe(0.0123);
    expect(messages[0]?.info.tokens?.output).toBe(20);
    expect(messages[0]?.info.time).toEqual({ created: 700, completed: 1200 });
  });

  test("`failed` records the error", () => {
    let messages = empty();
    messages = apply(
      messages,
      ev("session.step.failed", {
        assistantMessageID: MSG,
        error: { message: "rate limited" },
        finish: "error",
      }),
    );

    expect(messages[0]?.info.error).toBe("rate limited");
  });

  test("`ended` clears an error left by an earlier failure", () => {
    let messages = empty();
    messages = apply(
      messages,
      ev("session.step.failed", {
        assistantMessageID: MSG,
        error: { message: "boom" },
      }),
    );
    messages = apply(
      messages,
      ev("session.step.ended", { assistantMessageID: MSG, finish: "stop" }),
    );

    expect(messages[0]?.info.error).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// No-op events
// ---------------------------------------------------------------------------

describe("events that do not mutate the transcript", () => {
  const noopTypes = [
    "session.idle",
    "session.status",
    "session.execution.started",
    "session.execution.succeeded",
    "session.execution.failed",
    "session.execution.interrupted",
    "session.compaction.started",
    "session.compaction.delta",
    "session.compaction.ended",
    "session.compaction.failed",
    "session.revert.staged",
    "session.revert.cleared",
    "session.revert.committed",
  ];

  for (const type of noopTypes) {
    test(`${type} returns null`, () => {
      expect(
        applyStreamEvent(withUserMessage(), ev(type, {}), SESSION),
      ).toBeNull();
    });
  }

  test("an unrecognised event type returns null rather than throwing", () => {
    const event = {
      type: "session.somethingNew",
      data: { sessionID: SESSION },
      created: 1000,
    } as unknown as AnyEvent;

    expect(applyStreamEvent(withUserMessage(), event, SESSION)).toBeNull();
  });

  test("a pty or permission event is ignored", () => {
    const pty = {
      type: "pty.created",
      data: { sessionID: SESSION, id: "pty_1" },
      created: 1,
    } as unknown as AnyEvent;
    const permission = {
      type: "permission.asked",
      data: { sessionID: SESSION, requestID: "r1" },
      created: 1,
    } as unknown as AnyEvent;

    expect(applyStreamEvent(withUserMessage(), pty, SESSION)).toBeNull();
    expect(applyStreamEvent(withUserMessage(), permission, SESSION)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Mixed traffic
// ---------------------------------------------------------------------------

describe("mixed traffic", () => {
  test("a full text-then-tool turn folds into one message", () => {
    let messages = empty();

    messages = apply(
      messages,
      ev("session.step.started", {
        assistantMessageID: MSG,
        agent: "build",
        model: { id: "m", providerID: "p" },
        started: 700,
      }),
    );
    messages = apply(
      messages,
      ev("session.reasoning.delta", {
        assistantMessageID: MSG,
        ordinal: 0,
        delta: "plan",
      }),
    );
    messages = apply(
      messages,
      ev("session.text.delta", {
        assistantMessageID: MSG,
        ordinal: 1,
        delta: "running ls",
      }),
    );
    messages = apply(
      messages,
      ev("session.tool.input.started", {
        assistantMessageID: MSG,
        id: "t1",
        name: "bash",
      }),
    );
    messages = apply(
      messages,
      ev("session.tool.called", {
        assistantMessageID: MSG,
        id: "t1",
        input: { cmd: "ls" },
      }),
    );
    messages = apply(
      messages,
      ev("session.tool.success", {
        assistantMessageID: MSG,
        id: "t1",
        content: [{ type: "text", text: "a\nb\nc" }],
      }),
    );
    messages = apply(
      messages,
      ev("session.text.ended", {
        assistantMessageID: MSG,
        ordinal: 1,
        text: "running ls",
      }),
    );
    messages = apply(
      messages,
      ev(
        "session.step.ended",
        { assistantMessageID: MSG, finish: "stop" },
        1200,
      ),
    );

    expect(messages).toHaveLength(1);

    const message = messages[0]!;
    expect(message.parts.map((p) => p.type)).toEqual([
      "reasoning",
      "text",
      "tool",
    ]);
    expect(reasoningPart(message, 0).text).toBe("plan");
    expect(textPart(message, 1).text).toBe("running ls");
    expect(toolPart(message, "t1").content).toEqual([
      { type: "text", text: "a\nb\nc" },
    ]);
    expect(message.info.finish).toBe("stop");
    expect(message.info.time.completed).toBe(1200);
  });

  test("interleaved turns stay on separate messages", () => {
    let messages = empty();
    messages = apply(
      messages,
      ev("session.text.delta", {
        assistantMessageID: "msg_a",
        ordinal: 0,
        delta: "A",
      }),
    );
    messages = apply(
      messages,
      ev("session.text.delta", {
        assistantMessageID: "msg_b",
        ordinal: 0,
        delta: "B",
      }),
    );

    expect(messages.map((m) => m.info.id)).toEqual(["msg_a", "msg_b"]);
  });
});

// ---------------------------------------------------------------------------
// Busy state
// ---------------------------------------------------------------------------

describe("isAgentBusyEvent", () => {
  test("`session.idle` reports not busy", () => {
    expect(isAgentBusyEvent(ev("session.idle", {}))).toBe(false);
  });

  test("`execution.started` reports busy", () => {
    expect(isAgentBusyEvent(ev("session.execution.started", {}))).toBe(true);
  });

  for (const type of [
    "session.execution.succeeded",
    "session.execution.failed",
    "session.execution.interrupted",
  ]) {
    test(`${type} reports not busy`, () => {
      expect(isAgentBusyEvent(ev(type, {}))).toBe(false);
    });
  }

  test("a running tool reports busy", () => {
    expect(
      isAgentBusyEvent(
        ev("session.tool.called", {
          assistantMessageID: MSG,
          id: "t",
          input: {},
        }),
      ),
    ).toBe(true);
  });

  test("tool progress reports busy", () => {
    expect(
      isAgentBusyEvent(
        ev("session.tool.progress", {
          assistantMessageID: MSG,
          id: "t",
          metadata: {},
        }),
      ),
    ).toBe(true);
  });

  test("tool completion says nothing, because `session.idle` is authoritative", () => {
    expect(
      isAgentBusyEvent(
        ev("session.tool.success", {
          assistantMessageID: MSG,
          id: "t",
          content: [],
        }),
      ),
    ).toBeNull();
    expect(
      isAgentBusyEvent(
        ev("session.tool.failed", {
          assistantMessageID: MSG,
          id: "t",
          error: { message: "x" },
        }),
      ),
    ).toBeNull();
  });

  test("`session.status` derives busy from its status payload", () => {
    expect(
      isAgentBusyEvent(ev("session.status", { status: { type: "busy" } })),
    ).toBe(true);
    expect(
      isAgentBusyEvent(ev("session.status", { status: { type: "retry" } })),
    ).toBe(true);
    expect(
      isAgentBusyEvent(ev("session.status", { status: { type: "idle" } })),
    ).toBe(false);
  });

  test("unrelated events say nothing", () => {
    expect(
      isAgentBusyEvent(
        ev("session.text.delta", {
          assistantMessageID: MSG,
          ordinal: 0,
          delta: "x",
        }),
      ),
    ).toBeNull();
    expect(isAgentBusyEvent(ev("pty.created", { id: "p" }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Refetch triggers
// ---------------------------------------------------------------------------

describe("shouldRefetchMessages", () => {
  for (const type of [
    "session.compaction.ended",
    "session.compaction.failed",
    "session.revert.staged",
    "session.revert.cleared",
    "session.revert.committed",
  ]) {
    test(`${type} invalidates the cached list`, () => {
      expect(shouldRefetchMessages(ev(type, {}))).toBe(true);
    });
  }

  test("compaction start and delta do not refetch", () => {
    expect(shouldRefetchMessages(ev("session.compaction.started", {}))).toBe(
      false,
    );
    expect(shouldRefetchMessages(ev("session.compaction.delta", {}))).toBe(
      false,
    );
  });

  test("ordinary transcript events do not refetch", () => {
    expect(
      shouldRefetchMessages(
        ev("session.text.delta", {
          assistantMessageID: MSG,
          ordinal: 0,
          delta: "x",
        }),
      ),
    ).toBe(false);
    expect(
      shouldRefetchMessages(
        ev("session.step.ended", { assistantMessageID: MSG }),
      ),
    ).toBe(false);
  });
});
