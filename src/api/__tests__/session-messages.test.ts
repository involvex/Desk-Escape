import { describe, expect, test } from "bun:test";
import type { OpenCodeClient } from "@opencode/client";

import { fetchSessionMessages } from "@/api/opencode/messages";

/**
 * Transcript pagination.
 *
 * The bug these tests pin: the fetch loop used to send `order: "asc"` on every
 * page. The V2 server rejects `order` together with `cursor`
 * (`InvalidCursorError: Cursor cannot be combined with order`), so every session
 * longer than one page failed outright and the UI rendered it as empty.
 *
 * The double below enforces the same contract the server does, which is what
 * makes "never send both" assertable rather than a comment.
 */

interface ListCall {
  sessionID: string;
  cursor?: string;
  order?: "asc" | "desc";
}

function userMessage(index: number) {
  return {
    id: `msg_${String(index).padStart(3, "0")}`,
    type: "user" as const,
    time: { created: 1000 + index },
    text: `message ${index}`,
  };
}

function invalidCursorError() {
  return Object.assign(new Error("Cursor cannot be combined with order"), {
    _tag: "InvalidCursorError",
  });
}

/**
 * Stand-in for `message.list`.
 *
 * Mirrors two server behaviours: a cursor encodes the ordering (so `order` must
 * be absent once paging starts), and the last data page is followed by a cursor
 * pointing at an empty page.
 */
function serverDouble(total: number, pageSize = 50) {
  const calls: ListCall[] = [];
  const client = {
    message: {
      list: async (input: ListCall) => {
        calls.push(input);
        if (input.cursor !== undefined && input.order !== undefined) {
          throw invalidCursorError();
        }
        const start = input.cursor ? Number(input.cursor) : 0;
        const count = Math.max(0, Math.min(pageSize, total - start));
        const data = Array.from({ length: count }, (_, index) =>
          userMessage(start + index),
        );
        return {
          data,
          cursor: { previous: null, next: String(start + count) },
        };
      },
    },
  };
  return { client: client as unknown as OpenCodeClient, calls };
}

const ids = (messages: Awaited<ReturnType<typeof fetchSessionMessages>>) =>
  messages.map((message) => message.info.id);

const expectedIds = (total: number) =>
  Array.from(
    { length: total },
    (_, index) => `msg_${String(index).padStart(3, "0")}`,
  );

describe("fetchSessionMessages", () => {
  test("reads every page without ever sending `order` alongside `cursor`", async () => {
    const { client, calls } = serverDouble(70);

    const messages = await fetchSessionMessages(client, "ses_1");

    // 50 + 20 + the trailing empty page.
    expect(calls).toHaveLength(3);
    expect(ids(messages)).toEqual(expectedIds(70));

    expect(calls[0]).toMatchObject({ sessionID: "ses_1", order: "asc" });
    expect(calls[0]).not.toHaveProperty("cursor");

    for (const call of calls.slice(1)) {
      expect(call.sessionID).toBe("ses_1");
      expect(call).toHaveProperty("cursor");
      expect(call).not.toHaveProperty("order");
    }
  });

  test("a transcript that fits one page still loads, without duplicates", async () => {
    const { client, calls } = serverDouble(50);

    const messages = await fetchSessionMessages(client, "ses_1");

    expect(ids(messages)).toEqual(expectedIds(50));
    expect(new Set(ids(messages)).size).toBe(50);
    expect(calls).toHaveLength(2);
  });

  test("stops when the server repeats the same cursor", async () => {
    let calls = 0;
    const client = {
      message: {
        list: async () => {
          calls += 1;
          return {
            data: [userMessage(0)],
            cursor: { previous: null, next: "stuck" },
          };
        },
      },
    } as unknown as OpenCodeClient;

    const messages = await fetchSessionMessages(client, "ses_1");

    expect(ids(messages)).toEqual(["msg_000"]);
    expect(calls).toBe(2);
  });

  test("normalizes server errors instead of returning a partial transcript", async () => {
    const client = {
      message: {
        list: async () => {
          throw Object.assign(new Error("Session not found"), {
            _tag: "SessionNotFoundError",
          });
        },
      },
    } as unknown as OpenCodeClient;

    await expect(
      fetchSessionMessages(client, "ses_missing"),
    ).rejects.toMatchObject({ kind: "not-found" });
  });
});
