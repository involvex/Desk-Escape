import { useMutation } from "@tanstack/react-query";
import type { OpenCodeClient } from "@opencode/client";

import { withOpenCodeErrors } from "@/api/opencode/errors";
import { summarizeRevert, type RevertSummary } from "@/api/session-revert";
import { useConnection } from "@/context/ConnectionContext";

/**
 * Client calls and mutations for `session.revert.*`.
 *
 * ## No `location` here, and that is deliberate
 *
 * The revert inputs take `sessionID` and nothing else — no `location`, no
 * `directory`. That matches `session.get`, `session.prompt` and `message.list`:
 * a session's scope is fixed when it is created and only changes via
 * `session.move`. Passing a location to these endpoints is a schema error, not a
 * silently-ignored field, so they are called bare.
 *
 * The state machine that guards the two-phase flow lives in the pure
 * `session-revert` module; this file is only the transport.
 */

/**
 * Ask the server what a revert would change, without changing anything.
 *
 * Staging is not a dry run in the local sense — the server records the revert
 * and returns it — so a staged revert must be either committed or cleared.
 * That obligation is why {@link summarizeRevert} output is what the UI shows
 * before the user agrees to anything.
 */
export async function stageRevert(
  client: OpenCodeClient,
  input: { sessionId: string; messageId: string; files?: boolean },
): Promise<RevertSummary> {
  const revert = await withOpenCodeErrors(() =>
    client.session.revert.stage({
      sessionID: input.sessionId,
      messageID: input.messageId,
      ...(input.files ? { files: true } : {}),
    }),
  );
  return summarizeRevert(revert);
}

/**
 * Apply the staged revert.
 *
 * Destructive and irreversible: it rewinds the conversation and restores files
 * on disk. Callers are expected to have shown the staged summary first.
 */
export async function commitRevert(
  client: OpenCodeClient,
  sessionId: string,
): Promise<void> {
  await withOpenCodeErrors(() =>
    client.session.revert.commit({ sessionID: sessionId }),
  );
}

/** Abandon the staged revert, leaving the session as it was. */
export async function clearRevert(
  client: OpenCodeClient,
  sessionId: string,
): Promise<void> {
  await withOpenCodeErrors(() =>
    client.session.revert.clear({ sessionID: sessionId }),
  );
}

function useRevertClient(): OpenCodeClient | null {
  const { client } = useConnection();
  return client as OpenCodeClient | null;
}

/**
 * Stage a revert for a session.
 *
 * Returns the summary rather than the raw `SessionRevert` so the caller cannot
 * accidentally display the anchor id as though it were a file or a count.
 */
export function useStageRevert(sessionId: string | null) {
  const client = useRevertClient();
  return useMutation({
    mutationFn: async (input: {
      messageId: string;
      files?: boolean;
    }): Promise<RevertSummary> => {
      if (!client || !sessionId) {
        throw new Error("Not connected.");
      }
      return stageRevert(client, {
        sessionId,
        messageId: input.messageId,
        ...(input.files === undefined ? {} : { files: input.files }),
      });
    },
  });
}

/** Commit the staged revert. See {@link commitRevert} for what this costs. */
export function useCommitRevert(sessionId: string | null) {
  const client = useRevertClient();
  return useMutation({
    mutationFn: async (): Promise<void> => {
      if (!client || !sessionId) {
        throw new Error("Not connected.");
      }
      return commitRevert(client, sessionId);
    },
  });
}

/** Clear the staged revert without applying it. */
export function useClearRevert(sessionId: string | null) {
  const client = useRevertClient();
  return useMutation({
    mutationFn: async (): Promise<void> => {
      if (!client || !sessionId) {
        throw new Error("Not connected.");
      }
      return clearRevert(client, sessionId);
    },
  });
}
