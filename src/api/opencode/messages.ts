import type { OpenCodeClient, SessionMessageInfo } from "@opencode/client";

import { toChatMessages } from "./adapter";
import { withOpenCodeErrors } from "./errors";
import type { ChatMessage } from "@/types/domain";

/**
 * Read a session's full transcript.
 *
 * `message.list` pages with a cursor, and the pagination contract is stricter
 * than it looks: **`order` may only be sent on the first request.** Once a
 * `cursor` is present the server rejects the pair with `InvalidCursorError`
 * ("Cursor cannot be combined with order") — the ordering is already encoded in
 * the cursor. Sending both, which is the obvious way to write the loop, makes
 * every session longer than one page (50 messages by default) fail outright.
 *
 * Two other behaviours this loop accounts for:
 *
 * - `limit` *is* legal alongside a cursor; only `order` is not. The default page
 *   size is left to the server so payload sizes stay predictable on mobile.
 * - The last real page is followed by a cursor pointing at an empty page, so a
 *   naive loop always spends one extra round trip per session. Stop on the first
 *   empty page instead.
 */
export async function fetchSessionMessages(
  client: OpenCodeClient,
  sessionId: string,
): Promise<ChatMessage[]> {
  const messages: SessionMessageInfo[] = [];
  let cursor: string | undefined;

  do {
    const page = await withOpenCodeErrors(() =>
      client.message.list({
        sessionID: sessionId,
        ...(cursor ? { cursor } : { order: "asc" }),
      }),
    );

    const next = page.cursor?.next ?? undefined;

    // The last real page is followed by an empty one, and a cursor that repeats
    // itself would spin forever. Stop *before* adding either, so a repeated page
    // is not appended a second time.
    if (page.data.length === 0 || next === cursor) {
      break;
    }

    messages.push(...page.data);
    cursor = next;
  } while (cursor);

  return toChatMessages(messages);
}
