import { describe, expect, test } from "bun:test";

import { forkAnchorInput, forkOffer } from "@/api/session-fork";
import type { ChatMessage } from "@/types/domain";

/**
 * The fork cut arithmetic and its wording.
 *
 * `session.fork` is the only way to branch a conversation, and the one field that
 * decides what a branch contains is `before`. Getting it wrong by a message is
 * invisible in the request and obvious in the result, so the arithmetic that
 * derives it — and the copy that tells the user which side each message lands on
 * — are pinned here rather than left to the UI layer.
 */

let seq = 0;

/** A message with the given role; only `info.id` and `info.role` matter here. */
function message(role: "user" | "assistant" = "user"): ChatMessage {
  seq += 1;
  return {
    info: {
      id: `msg_${seq}`,
      role,
      kind: role === "user" ? "user" : "assistant",
      time: { created: seq },
    },
    parts: [],
  } as unknown as ChatMessage;
}

/** Four messages: user, assistant, user, assistant. */
function conversation(): ChatMessage[] {
  return [
    message("user"),
    message("assistant"),
    message("user"),
    message("assistant"),
  ];
}

describe("forkOffer", () => {
  test("anchors at the message it was asked about", () => {
    const messages = conversation();
    expect(forkOffer(messages, messages[2]!.info.id)?.anchorId).toBe("msg_3");
  });

  test("counts what carries over and what stays behind", () => {
    const messages = conversation();
    const offer = forkOffer(messages, messages[2]!.info.id);

    // Index 2 of 4: the two before it are inherited, this one and the one after
    // it are not. An off-by-one here is a conversation one message too long or too
    // short, with no error anywhere.
    expect(offer?.keeps).toBe(2);
    expect(offer?.leaves).toBe(2);
  });

  test("the kept and left counts always account for every message", () => {
    // The invariant behind the two counts: nothing is silently dropped between the
    // cut and the end of the conversation, and nothing is counted twice.
    const messages = conversation();
    for (let i = 1; i < messages.length; i += 1) {
      const offer = forkOffer(messages, messages[i]!.info.id);
      expect((offer?.keeps ?? 0) + (offer?.leaves ?? 0)).toBe(messages.length);
      expect(offer?.keeps).toBe(i);
    }
  });

  test("refuses the first message, which would inherit nothing", () => {
    const messages = conversation();
    // A fork before the opening message is an empty session — indistinguishable
    // from the plain new-session button, and strictly less useful.
    expect(forkOffer(messages, messages[0]!.info.id)).toBeNull();
  });

  test("refuses an id that is not in the conversation", () => {
    // Reachable: the tap comes from a rendered row and the list comes from
    // `message.list`, so a message removed by a concurrent turn leaves the id
    // dangling. Anchoring to it would fork somewhere unknown.
    expect(forkOffer(conversation(), "msg_missing")).toBeNull();
  });

  test("refuses everything in an empty conversation", () => {
    expect(forkOffer([], "msg_1")).toBeNull();
  });

  test("offers the branch from the last message", () => {
    // Nothing follows it, but forking above the last message is the ordinary case:
    // keep the conversation, drop the newest turn, ask something else.
    const messages = conversation();
    const offer = forkOffer(messages, messages[3]!.info.id);
    expect(offer?.keeps).toBe(3);
    expect(offer?.leaves).toBe(1);
  });

  test("branches from an assistant message as readily as from a user one", () => {
    // Forking above an answer — keeping the question, dropping the reply — is the
    // most useful branch there is, and it is the one that would be lost if only user
    // messages were considered.
    const messages = conversation();
    expect(forkOffer(messages, messages[1]!.info.id)).not.toBeNull();
  });

  describe("summary", () => {
    test("says which messages carry over and which stay", () => {
      const messages = conversation();
      const offer = forkOffer(messages, messages[2]!.info.id);
      expect(offer?.summary).toBe(
        "Forks before this message, keeping 2 earlier messages. " +
          "This message and everything after it stay in the original.",
      );
    });

    test("names the single carried message without a plural", () => {
      // Grammar a user notices. "1 earlier messages" reads as a bug in the app.
      const messages = conversation();
      const offer = forkOffer(messages, messages[1]!.info.id);
      expect(offer?.summary).toContain("keeping 1 earlier message.");
      expect(offer?.summary).not.toContain("1 earlier messages");
    });

    test("states the direction of the cut rather than implying a replacement", () => {
      // The whole feature is a branch, not an undo. Copy that could be read as
      // "this will be removed from the current conversation" is the one thing the
      // sheet must not say.
      const messages = conversation();
      const summary = forkOffer(messages, messages[2]!.info.id)?.summary ?? "";
      expect(summary).toContain("stay in the original");
      expect(summary).not.toMatch(/delete|remove|undo|replace/i);
    });
  });
});

describe("forkAnchorInput", () => {
  test("puts the anchor in `before`", () => {
    // `before` is the only field separating a branch from a copy of the whole
    // session. Sending it under any other name forks everything.
    expect(forkAnchorInput("msg_3")).toEqual({ before: "msg_3" });
  });

  test("carries no session id of its own", () => {
    // The session is a property of the connection, not of the cut. A function that
    // returned one would let a caller pair a session with a message from another.
    expect(Object.keys(forkAnchorInput("msg_3"))).toEqual(["before"]);
  });

  test("survives being composed with the session id", () => {
    expect({ sessionID: "ses_1", ...forkAnchorInput("msg_3") }).toEqual({
      sessionID: "ses_1",
      before: "msg_3",
    });
  });
});
