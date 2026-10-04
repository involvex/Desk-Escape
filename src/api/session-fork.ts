import type { SessionForkInput } from "@opencode/client";

import type { ChatMessage } from "@/types/domain";

/**
 * Where a fork cuts the conversation, and what that cut costs.
 *
 * ## What `before` means, and how sure we are
 *
 * `session.fork` takes `{ sessionID, before? }`. Omitting `before` forks the whole
 * session; passing a message id forks *before* it. The second reading is the one
 * used throughout this module, on two pieces of evidence and no server to probe:
 * the parameter is named `before` rather than `from`/`through`/`at`, and the
 * `session.forked` event reports `boundary: { type: "before" | "through", messageID }`
 * — the same two words, so the recorded boundary and the request parameter share a
 * vocabulary. `through` is what a whole-session fork records.
 *
 * This is a reading, not a verified fact, and `session-revert.ts` already hit the
 * same wall with `stage`'s identically-named parameter. So the consequence is not
 * hidden: {@link forkOffer}'s summary states what carries over and what stays
 * behind, in those words, *before* the user commits. If the server's anchor means
 * the opposite, the summary is where it shows up — on a copy, before a new session
 * exists, not after the conversation has been split somewhere unexpected.
 *
 * ## Forking destroys nothing
 *
 * Unlike a revert, this is additive: the server creates a new session and the
 * original keeps every message it had. That is why there is no staged/preview
 * phase and no confirmation beyond the action sheet itself — the worst outcome of
 * being wrong about the anchor is a new session containing one message more or
 * less than expected, which the user can delete.
 *
 * Kept pure so the cut arithmetic and its wording are testable without React or a
 * server.
 */

/** What forking from one message would produce. */
export interface ForkOffer {
  /** The message to send as `before` — the cut is *above* it. */
  anchorId: string;
  /** How many messages the new session inherits. */
  keeps: number;
  /** How many stay behind: this message and everything after it. */
  leaves: number;
  /** One line for the action sheet, saying which side each message lands on. */
  summary: string;
}

/**
 * `1 message` / `2 messages`.
 *
 * Written out rather than using a formatter: the wording is user-facing copy that
 * tests assert on, so it should read in the source.
 */
function count(n: number, singular: string): string {
  return `${n} ${n === 1 ? singular : `${singular}s`}`;
}

/**
 * The branch point at `messageId`, or `null` when there is nothing to branch from.
 *
 * `null` for the *first* message, not by accident: a fork before the first message
 * inherits nothing, so it is a brand-new empty session wearing a fork's clothes.
 * Offering it would be a way to make a new session that the plain "New session"
 * button already makes, better.
 *
 * `null` also for an id that is not in the list. That is not a hypothetical: the
 * list arrives from `message.list` and the tap comes from a rendered row, so a
 * message removed by a concurrent turn would otherwise anchor a fork to nothing.
 */
export function forkOffer(
  messages: readonly ChatMessage[],
  messageId: string,
): ForkOffer | null {
  const index = messages.findIndex((message) => message.info.id === messageId);
  if (index <= 0) {
    return null;
  }

  const keeps = index;
  const leaves = messages.length - index;

  return {
    anchorId: messageId,
    keeps,
    leaves,
    summary:
      `Forks before this message, keeping ${count(keeps, "earlier message")}. ` +
      "This message and everything after it stay in the original.",
  };
}

/**
 * The anchor half of the request input for a fork at `messageId`.
 *
 * `Pick`ed rather than the whole `SessionForkInput` because the session id belongs
 * to the caller — it is a property of the connection, not of the cut — and a
 * function that took both would be a function that could be handed a session and
 * a message that do not belong together.
 */
export function forkAnchorInput(
  messageId: string,
): Pick<SessionForkInput, "before"> {
  return { before: messageId };
}
