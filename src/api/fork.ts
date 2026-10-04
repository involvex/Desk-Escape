import { useMutation } from "@tanstack/react-query";
import type { OpenCodeClient, SessionInfo } from "@opencode/client";

import { withOpenCodeErrors } from "@/api/opencode/errors";
import { forkAnchorInput } from "@/api/session-fork";
import { useConnection } from "@/context/ConnectionContext";

/**
 * Client call and mutation for `session.fork`.
 *
 * ## No `location` here, and that is deliberate
 *
 * The fork input takes `sessionID` and `before` — no `location`, no `directory`.
 * Same reasoning as `revert.ts`: a session's scope is fixed when it is created, so
 * passing a location is a schema error rather than a silently-ignored field.
 *
 * The cut arithmetic and its wording live in the pure `session-fork` module; this
 * file is only the transport.
 *
 * ## `before` is exclusive, and the branch renumbers its messages
 *
 * Both verified against a live server (`scripts/probe-server-contracts.mjs`, Q1):
 *
 * - `before: X` keeps the messages that *precede* X and drops X itself. So a fork
 *   from the third of four messages carries the first two. `session-fork.ts` cut
 *   arithmetic assumed this and is right. A fork with no `before` copies
 *   everything, which is what makes the truncated case interpretable.
 * - Every message in the branch is given a **new id**. No source id survives the
 *   fork. Nothing here may match branch messages to source messages by id — the
 *   branch has to be re-listed. That is why this returns a session id and nothing
 *   about messages: the only thing to carry across is which session to open.
 */

/**
 * Branch a session, returning the new one.
 *
 * Returns the created `SessionInfo` rather than `void` because the caller has to
 * go somewhere afterwards: the whole point of forking is to continue in the new
 * session, and its id is the only thing the response carries that identifies it.
 */
export async function forkSession(
  client: OpenCodeClient,
  input: { sessionId: string; messageId: string },
): Promise<SessionInfo> {
  return withOpenCodeErrors(() =>
    client.session.fork({
      sessionID: input.sessionId,
      ...forkAnchorInput(input.messageId),
    }),
  );
}

/**
 * Branch the current session from a message.
 *
 * Additive and non-destructive, so there is nothing to confirm twice: the action
 * sheet the user already tapped through is the confirmation. On success the caller
 * is handed the new session's id — this hook does not switch to it, because
 * switching is a decision about which conversation is on screen and belongs to
 * whoever asked for the fork.
 */
export function useForkSession(sessionId: string | null) {
  const { client } = useConnection();

  return useMutation({
    mutationFn: async (input: { messageId: string }): Promise<SessionInfo> => {
      if (!client || !sessionId) {
        throw new Error("Not connected.");
      }
      return forkSession(client, { sessionId, messageId: input.messageId });
    },
  });
}
