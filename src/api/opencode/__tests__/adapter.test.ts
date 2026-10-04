import { describe, expect, test } from "bun:test";
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
  VcsFileStatus,
} from "@opencode/client";
import type { DiffHunk, DiffLine } from "@/types/opencode";

import {
  indexFileStatuses,
  isDisplayableMessage,
  markUntracked,
  parseUnifiedDiff,
  positionalPartId,
  toChatMessage,
  toChatMessages,
  toFileDiffEntry,
  toFileEntries,
  toFileEntry,
  toFileEntryList,
  toModel,
  toProvider,
  toSession,
} from "@/api/opencode/adapter";

/**
 * Tests for the V2 wire → domain translation.
 *
 * This module is where the app's whole domain model is invented from server
 * payloads, and nothing else re-checks the result: a mistranslated field does
 * not throw, it renders as a wrong transcript, a wrong cost, or an invisible file.
 * So the assertions here are about *values*, not just types.
 */

const tokens = {
  input: 100,
  output: 20,
  reasoning: 5,
  cache: { read: 7, write: 3 },
};

function assistant(overrides: Partial<SessionMessageAssistant> = {}) {
  return {
    id: "msg_1",
    type: "assistant",
    agent: "build",
    model: { id: "m1", providerID: "anthropic", modelID: "claude" },
    content: [],
    time: { created: 1_000 },
    ...overrides,
  } as unknown as SessionMessageAssistant;
}

/** Narrow a converted part for assertions without fighting the union. */
function part(parts: unknown[], index = 0) {
  return parts[index] as Record<string, unknown>;
}

/**
 * First hunk of a patch, asserted non-empty.
 *
 * `noUncheckedIndexedAccess` makes a bare destructure `DiffHunk | undefined`, and
 * non-null-asserting every call site hides the fact that an empty parse is a real
 * outcome these tests are checking for elsewhere.
 */
function firstHunk(patch: string): DiffHunk {
  const [hunk] = parseUnifiedDiff(patch);
  expect(
    hunk,
    `expected ${JSON.stringify(patch)} to yield a hunk`,
  ).toBeDefined();
  return hunk!;
}

/** First line of a hunk, asserted non-empty. */
function firstLine(hunk: DiffHunk): DiffLine {
  expect(hunk.lines.length).toBeGreaterThan(0);
  return hunk.lines[0]!;
}

/** First entry of a converted list, asserted non-empty. */
function first<T>(items: T[]): T {
  expect(items.length).toBeGreaterThan(0);
  return items[0]!;
}

// ---------------------------------------------------------------------------
// positionalPartId
// ---------------------------------------------------------------------------

describe("positionalPartId", () => {
  test("joins message id and ordinal", () => {
    expect(positionalPartId("msg_1", 0)).toBe("msg_1:0");
    expect(positionalPartId("msg_1", 12)).toBe("msg_1:12");
  });

  test("ordinal 0 is not confused with absent", () => {
    // The reducer matches on this string, so `msg:0` must not equal `msg:`.
    expect(positionalPartId("msg", 0)).not.toBe(positionalPartId("msg", 1));
  });
});

// ---------------------------------------------------------------------------
// isDisplayableMessage
// ---------------------------------------------------------------------------

describe("isDisplayableMessage", () => {
  // Generated rather than `test.each`: a readonly string tuple satisfies none of
  // bun's `test.each` overloads.
  for (const type of [
    "agent-switched",
    "model-switched",
    "location-switched",
    "idle",
  ] as const) {
    test(`drops the metadata-only ${type} message`, () => {
      const message = { id: "m", type, time: { created: 1 } };
      expect(isDisplayableMessage(message as SessionMessageInfo)).toBe(false);
      expect(toChatMessage(message as SessionMessageInfo)).toBeNull();
    });
  }

  for (const type of [
    "user",
    "assistant",
    "system",
    "synthetic",
    "skill",
    "shell",
  ] as const) {
    test(`keeps ${type}`, () => {
      const message = { id: "m", type, time: { created: 1 } };
      expect(isDisplayableMessage(message as SessionMessageInfo)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// toChatMessage: assistant
// ---------------------------------------------------------------------------

describe("toChatMessage — assistant", () => {
  test("maps identity, timing and model reference", () => {
    const chat = toChatMessage(
      assistant({
        time: { created: 1_000, completed: 2_000 },
        finish: "stop",
      }),
    )!;

    expect(chat.info.role).toBe("assistant");
    expect(chat.info.kind).toBe("assistant");
    expect(chat.info.time).toEqual({ created: 1_000, completed: 2_000 });
    expect(chat.info.modelID).toBe("m1");
    expect(chat.info.providerID).toBe("anthropic");
    expect(chat.info.agent).toBe("build");
    expect(chat.info.finish).toBe("stop");
  });

  test("flattens token usage including both cache directions", () => {
    // `cache` is a nested object on the wire and must not be dropped: the token
    // dashboard reads cache hits, and V1 already had them.
    const chat = toChatMessage(assistant({ tokens }))!;
    expect(chat.info.tokens).toEqual({
      input: 100,
      output: 20,
      reasoning: 5,
      cache: { read: 7, write: 3 },
    });
  });

  test("leaves tokens undefined when the server sent none", () => {
    // `undefined` rather than a zeroed object: a fabricated 0 would make an
    // untouched session look like it had consumed tokens.
    expect(toChatMessage(assistant())!.info.tokens).toBeUndefined();
  });

  test("maps the structured error to its message", () => {
    // `SessionStructuredError` is flat — `{ type, message }` — not nested under a
    // `data` envelope.
    const chat = toChatMessage(
      assistant({
        error: { type: "ProviderError", message: "rate limited" },
      }),
    )!;
    expect(chat.info.error).toBe("rate limited");
  });

  test("has no error when none was sent", () => {
    expect(toChatMessage(assistant())!.info.error).toBeUndefined();
  });

  test("gives text and reasoning parts their positional ids", () => {
    const chat = toChatMessage(
      assistant({
        content: [
          { type: "text", text: "thinking out loud" },
          {
            type: "reasoning",
            text: "weighing options",
            time: { created: 5, completed: 9 },
          },
        ],
      }),
    )!;

    expect(chat.parts).toHaveLength(2);
    expect(part(chat.parts, 0)).toEqual({
      id: "msg_1:0",
      type: "text",
      text: "thinking out loud",
    });
    expect(part(chat.parts, 1)).toEqual({
      id: "msg_1:1",
      type: "reasoning",
      text: "weighing options",
      time: { created: 5, completed: 9 },
    });
  });

  test("keeps ordinals aligned with content indexes", () => {
    // The stream reducer addresses parts by ordinal, so a text part at index 1
    // must be `msg:1` even when a tool part precedes it. Tool parts carry the
    // server's own id, so only the positional ones are at stake here.
    const chat = toChatMessage(
      assistant({
        content: [
          { type: "text", text: "first" },
          { type: "text", text: "second" },
        ],
      }),
    )!;
    expect(chat.parts.map((p) => p.id)).toEqual(["msg_1:0", "msg_1:1"]);
  });

  test("renders an unknown content variant as an empty text part", () => {
    // The exhaustiveness guard. It should be visible as a gap, not dropped —
    // a silently missing part looks identical to the agent not having said it.
    const chat = toChatMessage(
      assistant({ content: [{ type: "something-new" } as never] }),
    )!;
    expect(chat.parts).toHaveLength(1);
    expect(part(chat.parts, 0)).toEqual({
      id: "msg_1:0",
      type: "text",
      text: "",
    });
  });
});

// ---------------------------------------------------------------------------
// toChatMessage: tool states
// ---------------------------------------------------------------------------

describe("toChatMessage — tool parts", () => {
  function toolPart(state: unknown) {
    const chat = toChatMessage(
      assistant({
        content: [
          {
            id: "tool_1",
            type: "tool",
            callID: "call_1",
            name: "bash",
            state,
            time: { start: 10, end: 20 },
          },
        ] as never,
      }),
    )!;
    return part(chat.parts, 0);
  }

  test("keeps streaming arguments as raw JSON text", () => {
    // While streaming, `input` is still a partial JSON string. Parsing it would
    // produce `undefined` mid-argument, so it has to stay raw until it completes.
    const state: SessionMessageToolStateStreaming = {
      status: "streaming",
      input: '{"command":"ec',
    };
    const p = toolPart(state);
    expect(p.status).toBe("streaming");
    expect(p.rawInput).toBe('{"command":"ec');
    expect(p.input).toBeUndefined();
  });

  test("parses arguments once running", () => {
    const state: SessionMessageToolStateRunning = {
      status: "running",
      input: { command: "bun test" },
      metadata: { pid: 42 },
    };
    const p = toolPart(state);
    expect(p.status).toBe("running");
    expect(p.input).toEqual({ command: "bun test" });
    expect(p.metadata).toEqual({ pid: 42 });
    expect(p.rawInput).toBeUndefined();
  });

  test("translates completed text and file content", () => {
    const state: SessionMessageToolStateCompleted = {
      status: "completed",
      input: { path: "a.txt" },
      content: [
        { type: "text", text: "wrote 3 lines" },
        {
          type: "file",
          uri: "file:///a.txt",
          mime: "text/plain",
          name: "a.txt",
        },
        { type: "file", uri: "file:///b.png", mime: "image/png" },
      ],
      metadata: { exitCode: 0 },
    };
    const p = toolPart(state);
    expect(p.status).toBe("completed");
    expect(p.content).toEqual([
      { type: "text", text: "wrote 3 lines" },
      {
        type: "file",
        uri: "file:///a.txt",
        mime: "text/plain",
        name: "a.txt",
      },
      // A file with no `name` becomes null rather than undefined: the UI reads
      // `name` unconditionally when labelling an attachment.
      { type: "file", uri: "file:///b.png", mime: "image/png", name: null },
    ]);
    expect(p.metadata).toEqual({ exitCode: 0 });
  });

  test("surfaces the error message on a failed tool", () => {
    const state: SessionMessageToolStateError = {
      status: "error",
      input: { command: "false" },
      error: { type: "ToolError", message: "exited 1" },
    };
    const p = toolPart(state);
    expect(p.status).toBe("error");
    expect(p.error).toBe("exited 1");
    expect(p.content).toBeUndefined();
  });

  test("keeps partial content on a failed tool", () => {
    // Output produced before the failure is still worth showing.
    const state: SessionMessageToolStateError = {
      status: "error",
      input: {},
      error: { type: "ToolError", message: "timed out" },
      content: [{ type: "text", text: "partial output" }],
    };
    expect(toolPart(state).content).toEqual([
      { type: "text", text: "partial output" },
    ]);
  });

  test("falls back to an error status for an unrecognised state", () => {
    // Defensive: a status the switch does not know about must not render as
    // `undefined`, which the UI would treat as still-running forever.
    expect(toolPart({ status: "who-knows" }).status).toBe("error");
  });

  test("uses the server's tool id, not a positional one", () => {
    expect(toolPart({ status: "streaming", input: "" }).id).toBe("tool_1");
  });
});

// ---------------------------------------------------------------------------
// toChatMessage: user / system / compaction / shell
// ---------------------------------------------------------------------------

describe("toChatMessage — user and system", () => {
  test("wraps user text as a single part at ordinal 0", () => {
    const chat = toChatMessage({
      id: "u1",
      type: "user",
      text: "fix the build",
      time: { created: 5 },
    } as SessionMessageInfo)!;

    expect(chat.info.role).toBe("user");
    expect(chat.info.kind).toBe("user");
    expect(chat.parts).toEqual([
      { id: "u1:0", type: "text", text: "fix the build" },
    ]);
  });

  test.each(["system", "synthetic", "skill"] as const)(
    "renders %s as an assistant-role bubble carrying its kind",
    (type) => {
      const chat = toChatMessage({
        id: "s1",
        type,
        text: "note",
        time: { created: 5 },
      } as SessionMessageInfo)!;

      expect(chat.info.role).toBe("assistant");
      expect(chat.info.kind).toBe(type);
      expect(chat.parts).toEqual([{ id: "s1:0", type: "text", text: "note" }]);
    },
  );
});

describe("toChatMessage — compaction", () => {
  const base = {
    id: "c1",
    type: "compaction",
    time: { created: 10 },
    summary: "Earlier turns summarised",
  };

  test("carries the summary and cost when complete", () => {
    const chat = toChatMessage({
      ...base,
      status: "completed",
      reason: "auto",
      cost: 0.42,
      tokens,
    } as unknown as SessionMessageInfo)!;

    expect(chat.info.kind).toBe("compaction");
    expect(chat.info.cost).toBe(0.42);
    expect(chat.info.tokens?.input).toBe(100);
    expect(chat.info.error).toBeUndefined();
    expect(part(chat.parts, 0).text).toBe("Earlier turns summarised");
  });

  test("omits cost and tokens while running", () => {
    // They are genuinely absent mid-compaction. Coerced to 0 they would show up
    // as a real spend in the session list.
    const chat = toChatMessage({
      ...base,
      status: "running",
    } as unknown as SessionMessageInfo)!;

    expect(chat.info.cost).toBeUndefined();
    expect(chat.info.tokens).toBeUndefined();
  });

  test("reports the failure and blanks the summary", () => {
    // The summary is meaningless once compaction failed, and showing a stale one
    // would misrepresent what is in the context window.
    const chat = toChatMessage({
      ...base,
      status: "failed",
      error: { type: "Error", message: "out of memory" },
    } as unknown as SessionMessageInfo)!;

    expect(chat.info.error).toBe("out of memory");
    expect(part(chat.parts, 0).text).toBe("");
  });
});

describe("toChatMessage — shell", () => {
  const base = {
    id: "sh1",
    type: "shell",
    shellID: "pty_1",
    command: "bun test",
    time: { created: 1, completed: 2 },
  };

  test("a running shell has no exit code and no error", () => {
    const chat = toChatMessage({
      ...base,
      status: "running",
    } as unknown as SessionMessageInfo)!;

    const p = part(chat.parts, 0);
    expect(p.status).toBe("running");
    expect(p.tool).toBe("shell");
    expect(p.error).toBeUndefined();
    expect(chat.info.exit).toBeUndefined();
  });

  test("exit 0 is a completed tool", () => {
    const chat = toChatMessage({
      ...base,
      status: "exited",
      exit: 0,
      output: { output: "ok", cursor: 2, size: 2, truncated: false },
    } as unknown as SessionMessageInfo)!;

    const p = part(chat.parts, 0);
    expect(p.status).toBe("completed");
    expect(p.content).toEqual([{ type: "text", text: "ok" }]);
    expect(chat.info.exit).toBe(0);
  });

  test("a non-zero exit is an error carrying the code", () => {
    const chat = toChatMessage({
      ...base,
      status: "exited",
      exit: 2,
    } as unknown as SessionMessageInfo)!;

    expect(part(chat.parts, 0).status).toBe("error");
    expect(part(chat.parts, 0).error).toBe("Exited with 2");
  });

  test("a killed shell reports an unknown exit rather than NaN", () => {
    // `exit` is optional, and a template literal would render `undefined` here.
    const chat = toChatMessage({
      ...base,
      status: "killed",
    } as unknown as SessionMessageInfo)!;

    expect(part(chat.parts, 0).error).toBe("Exited with unknown");
    expect(chat.info.exit).toBeUndefined();
  });

  test("a non-numeric exit sentinel is not promoted to info.exit", () => {
    // The wire type allows "Infinity"/"NaN" strings; `info.exit` is typed
    // number | undefined and the UI formats it as a number.
    const chat = toChatMessage({
      ...base,
      status: "exited",
      exit: "Infinity",
    } as unknown as SessionMessageInfo)!;

    expect(chat.info.exit).toBeUndefined();
    expect(part(chat.parts, 0).error).toBe("Exited with Infinity");
  });

  test("empty output yields no content rather than an empty text part", () => {
    const chat = toChatMessage({
      ...base,
      status: "running",
      output: { output: "", cursor: 0, size: 0, truncated: false },
    } as unknown as SessionMessageInfo)!;

    expect(part(chat.parts, 0).content).toBeUndefined();
  });

  test("passes the command through as the tool input", () => {
    const chat = toChatMessage({
      ...base,
      status: "running",
    } as unknown as SessionMessageInfo)!;
    expect(part(chat.parts, 0).input).toEqual({ command: "bun test" });
  });
});

// ---------------------------------------------------------------------------
// toChatMessages
// ---------------------------------------------------------------------------

describe("toChatMessages", () => {
  test("drops undisplayable messages instead of leaving nulls", () => {
    const messages = [
      { id: "u", type: "user", text: "hi", time: { created: 1 } },
      { id: "i", type: "idle", time: { created: 2 } },
      assistant({ id: "a" }),
    ] as unknown as SessionMessageInfo[];

    const result = toChatMessages(messages);
    expect(result.map((m) => m.info.id)).toEqual(["u", "a"]);
    expect(result.every((m) => m !== null)).toBe(true);
  });

  test("returns an empty list for no messages", () => {
    expect(toChatMessages([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// toSession
// ---------------------------------------------------------------------------

describe("toSession", () => {
  const info = {
    id: "ses_1",
    title: "Fix login",
    location: { directory: "/repo/app" },
    projectID: "proj_1",
    cost: 1.5,
    tokens,
    outcome: "succeeded",
    time: { created: 100, updated: 200, idle: 150 },
  } as unknown as SessionInfo;

  test("reads the directory out of the V2 location wrapper", () => {
    // V2 nests it as `location.directory`; there is no top-level `directory`.
    expect(toSession(info).directory).toBe("/repo/app");
  });

  test("leaves the directory undefined when the server omits the location", () => {
    const { location: _location, ...withoutLocation } = info;
    expect(toSession(withoutLocation as SessionInfo).directory).toBeUndefined();
  });

  test("carries identity, timing and outcome", () => {
    const session = toSession(info);
    expect(session.id).toBe("ses_1");
    expect(session.title).toBe("Fix login");
    expect(session.projectID).toBe("proj_1");
    expect(session.time).toEqual({ created: 100, updated: 200 });
    expect(session.outcome).toBe("succeeded");
    expect(session.cost).toBe(1.5);
  });

  test("flattens token usage", () => {
    expect(toSession(info).tokens).toEqual({
      input: 100,
      output: 20,
      reasoning: 5,
      cache: { read: 7, write: 3 },
    });
  });

  test("has no outcome when the server sent none", () => {
    const { outcome: _outcome, ...noOutcome } = info;
    expect(toSession(noOutcome as SessionInfo).outcome).toBeUndefined();
  });

  test("keeps parentID for child sessions", () => {
    expect(
      toSession({ ...info, parentID: "ses_0" } as SessionInfo).parentID,
    ).toBe("ses_0");
  });
});

// ---------------------------------------------------------------------------
// File entries
// ---------------------------------------------------------------------------

describe("toFileEntry", () => {
  test("derives the display name from the path", () => {
    // V2 dropped `children` and the name has to come from somewhere.
    expect(toFileEntry({ path: "src/api/hooks.ts", type: "file" })).toEqual({
      path: "src/api/hooks.ts",
      name: "hooks.ts",
      type: "file",
    });
  });

  test("handles Windows separators", () => {
    // The listing and the status endpoints can disagree on separator for the
    // same host, so the name must not depend on which one answered.
    expect(toFileEntry({ path: "src\\api\\hooks.ts", type: "file" }).name).toBe(
      "hooks.ts",
    );
  });

  test("falls back to the whole path when the last segment is empty", () => {
    // `basename` returns `segments.at(-1) || path`, so a trailing separator makes
    // the last segment `""` and the entire path becomes the display name. Pinned
    // rather than fixed: it is not established that `file.list` emits trailing
    // separators, and changing the fallback would alter the empty-path case too.
    // Logged as latent in suggestions.md §5.4c.
    expect(toFileEntry({ path: "src/api/", type: "directory" }).name).toBe(
      "src/api/",
    );
  });

  test("falls back to the whole path when there is no last segment", () => {
    expect(toFileEntry({ path: "", type: "file" }).name).toBe("");
  });
});

describe("toFileEntries", () => {
  test("puts directories before files", () => {
    const entries: FileSystemEntry[] = [
      { path: "zebra.ts", type: "file" },
      { path: "src", type: "directory" },
      { path: "apple.ts", type: "file" },
      { path: "assets", type: "directory" },
    ];
    expect(toFileEntries(entries).map((e) => e.name)).toEqual([
      "assets",
      "src",
      "apple.ts",
      "zebra.ts",
    ]);
  });

  test("sorts case-insensitively", () => {
    // A plain `localeCompare` would put "Zebra.ts" before "apple.ts" on some
    // locales, which reads as random to the user.
    const entries: FileSystemEntry[] = [
      { path: "apple.ts", type: "file" },
      { path: "Banana.ts", type: "file" },
      { path: "cherry.ts", type: "file" },
    ];
    expect(toFileEntries(entries).map((e) => e.name)).toEqual([
      "apple.ts",
      "Banana.ts",
      "cherry.ts",
    ]);
  });

  test("sorts numbers naturally", () => {
    const entries: FileSystemEntry[] = [
      { path: "file10.ts", type: "file" },
      { path: "file2.ts", type: "file" },
    ];
    expect(toFileEntries(entries).map((e) => e.name)).toEqual([
      "file2.ts",
      "file10.ts",
    ]);
  });

  test("handles an empty listing", () => {
    expect(toFileEntries([])).toEqual([]);
  });
});

describe("toFileEntryList", () => {
  test("returns an empty list for a non-array", () => {
    // The React Query layer's return type is being migrated independently, so
    // this defends against `undefined` and error payloads.
    expect(toFileEntryList(undefined)).toEqual([]);
    expect(toFileEntryList(null)).toEqual([]);
    expect(toFileEntryList({})).toEqual([]);
    expect(toFileEntryList("nope")).toEqual([]);
  });

  test("drops entries that are not recognisable", () => {
    expect(
      toFileEntryList([
        null,
        "string",
        42,
        {},
        { path: "", type: "file" },
        { path: "a.ts" },
        { path: "b.ts", type: "symlink" },
      ]),
    ).toEqual([]);
  });

  test("keeps valid entries and derives a missing name", () => {
    const result = toFileEntryList([
      { path: "src/app.ts", type: "file" },
      { path: "src/lib", type: "directory" },
    ]);
    expect(result).toEqual([
      { path: "src/lib", name: "lib", type: "directory" },
      { path: "src/app.ts", name: "app.ts", type: "file" },
    ]);
  });

  test("prefers an explicit name over the derived one", () => {
    expect(
      first(
        toFileEntryList([{ path: "src/app.ts", type: "file", name: "Custom" }]),
      ).name,
    ).toBe("Custom");
  });

  test("ignores an empty name and derives instead", () => {
    // `name: ""` is falsy; letting it through would render a blank row.
    expect(
      first(toFileEntryList([{ path: "src/app.ts", type: "file", name: "" }]))
        .name,
    ).toBe("app.ts");
  });

  test("sorts the surviving entries", () => {
    const result = toFileEntryList([
      { path: "b.ts", type: "file" },
      { path: "z", type: "directory" },
      { path: "a.ts", type: "file" },
    ]);
    expect(result.map((e) => e.name)).toEqual(["z", "a.ts", "b.ts"]);
  });
});

// ---------------------------------------------------------------------------
// VCS status
// ---------------------------------------------------------------------------

describe("indexFileStatuses", () => {
  const status = (file: string): VcsFileStatus => ({
    file,
    additions: 1,
    deletions: 0,
    status: "modified",
  });

  test("keys entries by path", () => {
    const index = indexFileStatuses([status("a.ts")]);
    expect(index.get("a.ts")?.file).toBe("a.ts");
  });

  test("normalises separators so the two endpoints agree", () => {
    // `file.list` and `vcs.status` can report the same file with different
    // separators; unnormalised, the diff view would show it as untracked *and*
    // modified at once.
    const index = indexFileStatuses([status("src\\app.ts")]);
    expect(index.get("src/app.ts")).toBeDefined();
    expect(index.has("src\\app.ts")).toBe(false);
  });

  test("strips a leading ./ and trailing slashes", () => {
    const index = indexFileStatuses([status("./src/app.ts")]);
    expect(index.get("src/app.ts")).toBeDefined();
  });

  test("handles an absent list", () => {
    expect(indexFileStatuses(undefined).size).toBe(0);
    expect(indexFileStatuses([]).size).toBe(0);
  });

  test("skips entries with no usable path", () => {
    const index = indexFileStatuses([
      status(""),
      { file: undefined } as unknown as VcsFileStatus,
      status("ok.ts"),
    ]);
    expect([...index.keys()]).toEqual(["ok.ts"]);
  });

  test("a later duplicate wins", () => {
    const index = indexFileStatuses([
      { ...status("a.ts"), additions: 1 },
      { ...status("a.ts"), additions: 9 },
    ]);
    expect(index.get("a.ts")?.additions).toBe(9);
  });
});

describe("markUntracked", () => {
  test("reports listed files the status does not mention", () => {
    // V2 dropped the "untracked" status entirely, so a file git has never seen is
    // simply absent from `vcs.status`. Without this the diff view would hide it.
    const known = indexFileStatuses([
      { file: "tracked.ts", additions: 0, deletions: 0, status: "modified" },
    ]);
    expect(markUntracked(["tracked.ts", "brand-new.ts"], known)).toEqual([
      { file: "brand-new.ts", additions: 0, deletions: 0, status: "added" },
    ]);
  });

  test("counts are zero because they are not measured", () => {
    const result = markUntracked(["new.ts"], indexFileStatuses([]));
    expect(first(result).additions).toBe(0);
    expect(first(result).deletions).toBe(0);
  });

  test("matches across separator differences", () => {
    // The listing says `src\app.ts` and the status says `src/app.ts`; reporting
    // it as untracked too would double it in the diff.
    const known = indexFileStatuses([
      { file: "src/app.ts", additions: 2, deletions: 1, status: "modified" },
    ]);
    expect(markUntracked(["src\\app.ts"], known)).toEqual([]);
  });

  test("matches a ./ prefixed listing path", () => {
    const known = indexFileStatuses([
      { file: "app.ts", additions: 1, deletions: 0, status: "modified" },
    ]);
    expect(markUntracked(["./app.ts"], known)).toEqual([]);
  });

  test("returns nothing when every listed file is known", () => {
    const known = indexFileStatuses([
      { file: "a.ts", additions: 0, deletions: 0, status: "modified" },
    ]);
    expect(markUntracked(["a.ts"], known)).toEqual([]);
  });

  test("handles an empty listing", () => {
    expect(markUntracked([], indexFileStatuses([]))).toEqual([]);
  });

  test("does not deduplicate the listing", () => {
    // Reporting a file twice would render two rows for one file. The listing is
    // assumed unique, which matches what `file.list` returns.
    const result = markUntracked(["dup.ts", "dup.ts"], indexFileStatuses([]));
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// parseUnifiedDiff
// ---------------------------------------------------------------------------

describe("parseUnifiedDiff", () => {
  test("splits hunks on @@ headers", () => {
    const patch = [
      "@@ -1,3 +1,4 @@",
      " context",
      "-removed",
      "+added",
      "@@ -10,2 +11,2 @@",
      " tail",
    ].join("\n");

    const hunks = parseUnifiedDiff(patch);
    expect(hunks).toHaveLength(2);
    expect(first(hunks).header).toBe("@@ -1,3 +1,4 @@");
    expect(hunks[1]!.header).toBe("@@ -10,2 +11,2 @@");
  });

  test("classifies add, remove and context lines", () => {
    const hunks = parseUnifiedDiff(
      ["@@ -1,3 +1,3 @@", " same", "-gone", "+here"].join("\n"),
    );
    expect(first(hunks).lines).toEqual([
      { type: "context", content: "same" },
      { type: "remove", content: "gone" },
      { type: "add", content: "here" },
    ]);
  });

  test("keeps the leading marker off the content", () => {
    // The UI renders `+`/`-` itself from the type; leaving it in the content
    // would double it.
    const hunk = firstHunk("@@ -1 +1 @@\n+added line");
    expect(firstLine(hunk).content).toBe("added line");
  });

  test("preserves indentation inside a line", () => {
    const hunk = firstHunk("@@ -1 +1 @@\n+    indented");
    expect(firstLine(hunk).content).toBe("    indented");
  });

  test("skips the file header before the first @@", () => {
    // `--- a/x` / `+++ b/x` are not diff lines. Treating them as removals and
    // additions would render the filenames as changed code.
    const hunks = parseUnifiedDiff(
      ["diff --git a/x b/x", "--- a/x", "+++ b/x", "@@ -1 +1 @@", "+real"].join(
        "\n",
      ),
    );
    expect(hunks).toHaveLength(1);
    expect(first(hunks).lines).toEqual([{ type: "add", content: "real" }]);
  });

  test("drops the no-newline marker", () => {
    const hunk = firstHunk(
      ["@@ -1 +1 @@", "+last", "\\ No newline at end of file"].join("\n"),
    );
    expect(hunk.lines).toEqual([{ type: "add", content: "last" }]);
  });

  test("ignores lines that carry no marker", () => {
    const hunk = firstHunk("@@ -1 +1 @@\nbare");
    expect(hunk.lines).toEqual([]);
  });

  test("treats a leading space as a context marker, not as noise", () => {
    // A context line's marker *is* the space, so stripping exactly one leaves the
    // original indentation intact.
    const hunk = firstHunk("@@ -1 +1 @@\n  indented");
    expect(hunk.lines).toEqual([{ type: "context", content: " indented" }]);
  });

  test("returns no hunks for an empty patch", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });

  test("returns no hunks for a header-only patch", () => {
    expect(parseUnifiedDiff("diff --git a/x b/x")).toEqual([]);
  });

  test("keeps an empty hunk rather than dropping it", () => {
    // A hunk header with no body is a real (if degenerate) diff; dropping it
    // would lose the fact that the file changed at that position.
    expect(parseUnifiedDiff("@@ -1,0 +1,0 @@")).toEqual([
      { header: "@@ -1,0 +1,0 @@", lines: [] },
    ]);
  });

  test("handles CRLF patches", () => {
    const hunk = firstHunk("@@ -1 +1 @@\r\n+added\r\n");
    // The \r is trailing whitespace on the content, not a separate line.
    expect(hunk.lines).toHaveLength(1);
    expect(firstLine(hunk).type).toBe("add");
  });
});

describe("toFileDiffEntry", () => {
  test("renames file to path and parses the patch", () => {
    const info: FileDiffInfo = {
      file: "src/app.ts",
      patch: "@@ -1 +1 @@\n-a\n+b",
      additions: 1,
      deletions: 1,
      status: "modified",
    };
    expect(toFileDiffEntry(info)).toEqual({
      path: "src/app.ts",
      hunks: [
        {
          header: "@@ -1 +1 @@",
          lines: [
            { type: "remove", content: "a" },
            { type: "add", content: "b" },
          ],
        },
      ],
    });
  });

  test("treats a missing patch as no hunks", () => {
    // A binary file has additions/deletions but no textual patch.
    const info = {
      file: "logo.png",
      additions: 0,
      deletions: 0,
      status: "modified",
    } as unknown as FileDiffInfo;
    expect(toFileDiffEntry(info)).toEqual({ path: "logo.png", hunks: [] });
  });
});

// ---------------------------------------------------------------------------
// Models and providers
// ---------------------------------------------------------------------------

describe("toModel", () => {
  const base = {
    id: "anthropic/claude",
    modelID: "claude",
    providerID: "anthropic",
    name: "Claude",
    family: "claude",
    status: "active",
    enabled: true,
    capabilities: { input: ["text"], output: ["text"], tools: true },
    variants: [{ id: "high" }, { id: "low" }],
    limit: { context: 200_000, output: 8_000 },
    cost: [{ input: 3, output: 15, cache: { read: 0.3, write: 3.75 } }],
    time: { released: 1 },
  } as unknown as ModelInfo;

  test("copies identity through", () => {
    const model = toModel(base);
    expect(model.id).toBe("anthropic/claude");
    expect(model.modelID).toBe("claude");
    expect(model.providerID).toBe("anthropic");
    expect(model.family).toBe("claude");
    expect(model.enabled).toBe(true);
  });

  test("derives reasoning from the compatibility flag", () => {
    // V2 folded V1's boolean `reasoning` capability into `compatibility`.
    expect(toModel(base).capabilities.reasoning).toBe(false);
    expect(
      toModel({
        ...base,
        compatibility: { reasoningField: "reasoning" },
      } as unknown as ModelInfo).capabilities.reasoning,
    ).toBe(true);
  });

  test("derives attachment from a non-text input modality", () => {
    expect(toModel(base).capabilities.attachment).toBe(false);
    expect(
      toModel({
        ...base,
        capabilities: { ...base.capabilities, input: ["text", "image"] },
      } as unknown as ModelInfo).capabilities.attachment,
    ).toBe(true);
  });

  test("reads toolCall from capabilities.tools", () => {
    expect(toModel(base).capabilities.toolCall).toBe(true);
    expect(
      toModel({
        ...base,
        capabilities: { ...base.capabilities, tools: false },
      } as unknown as ModelInfo).capabilities.toolCall,
    ).toBe(false);
  });

  test("tolerates missing capability lists", () => {
    const model = toModel({
      id: "m",
      modelID: "m",
      providerID: "p",
      name: "M",
      status: "active",
      enabled: true,
    } as unknown as ModelInfo);
    expect(model.capabilities.input).toEqual([]);
    expect(model.capabilities.output).toEqual([]);
    expect(model.capabilities.attachment).toBe(false);
  });

  test("takes only the first cost tier", () => {
    // The UI shows a single price; silently averaging tiers would misquote it.
    expect(toModel(base).cost).toEqual({
      input: 3,
      output: 15,
      cache: { read: 0.3, write: 3.75 },
    });
  });

  test("defaults a missing cost tier to zero", () => {
    // A free model reports an empty `cost` array, not a tier of zeros.
    const model = toModel({ ...base, cost: [] } as unknown as ModelInfo);
    expect(model.cost).toEqual({
      input: 0,
      output: 0,
      cache: { read: 0, write: 0 },
    });
  });

  test("defaults a missing cache tier to zero", () => {
    const model = toModel({
      ...base,
      cost: [{ input: 1, output: 2 }],
    } as unknown as ModelInfo);
    expect(model.cost.cache).toEqual({ read: 0, write: 0 });
  });

  test("carries limits and variant ids", () => {
    const model = toModel(base);
    expect(model.limit).toEqual({ context: 200_000, output: 8_000 });
    expect(model.variants).toEqual(["high", "low"]);
  });

  test("has no variants when the server sent none", () => {
    const model = toModel({ ...base, variants: [] } as unknown as ModelInfo);
    expect(model.variants).toEqual([]);
  });

  test("defaults a missing output limit to undefined", () => {
    const model = toModel({
      ...base,
      limit: { context: 1000 },
    } as unknown as ModelInfo);
    expect(model.limit.output).toBeUndefined();
    expect(model.limit.context).toBe(1000);
  });
});

describe("toProvider", () => {
  const info = { id: "anthropic", name: "Anthropic" } as ProviderInfo;

  const models = [
    toModel({ id: "anthropic/claude", providerID: "anthropic" } as ModelInfo),
    toModel({ id: "openai/gpt", providerID: "openai" } as ModelInfo),
  ];

  test("keys only its own models", () => {
    // A provider showing another provider's models would break model switching.
    const provider = toProvider(info, models);
    expect(Object.keys(provider.models)).toEqual(["anthropic/claude"]);
  });

  test("carries id and name", () => {
    const provider = toProvider(info, models);
    expect(provider.id).toBe("anthropic");
    expect(provider.name).toBe("Anthropic");
  });

  test("handles a provider with no models", () => {
    expect(toProvider(info, []).models).toEqual({});
  });

  test("keys by model id, not by index", () => {
    const provider = toProvider(info, [
      toModel({ id: "anthropic/one", providerID: "anthropic" } as ModelInfo),
      toModel({ id: "anthropic/two", providerID: "anthropic" } as ModelInfo),
    ]);
    expect(Object.keys(provider.models).sort()).toEqual([
      "anthropic/one",
      "anthropic/two",
    ]);
  });
});
