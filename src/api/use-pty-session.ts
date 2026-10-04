import { useCallback, useEffect, useRef, useState } from "react";
import type { OpenCodeClient, Pty } from "@opencode/client";
import { useConnection } from "@/context/ConnectionContext";
import { toOpenCodeError, withOpenCodeErrors } from "@/api/opencode/errors";
import { withLocation } from "@/api/opencode/location";
import { planPtyLifecycle, shouldKeepSession } from "@/api/pty-lifecycle";
import type { TerminalShell } from "@/context/PreferencesContext";

export type PtySessionStatus = "idle" | "loading" | "ready" | "error";

export interface PtyConnectTicket {
  /** Short-lived token that must be presented on the WebSocket URL. */
  ticket: string;
  /** Lifetime in seconds, as reported by the server. */
  expiresIn: number;
}

/**
 * Redeem a PTY connect ticket (V2 WebSocket auth).
 *
 * V1 put a base64 HTTP Basic pair in the socket query string. V2 instead
 * issues a short-lived ticket over HTTP and expects it in `?ticket=`. The
 * `x-opencode-ticket: 1` header is mandatory: it is what tells the server this
 * caller is asking for a socket ticket rather than a normal API call, and it
 * is what bypasses the credential check.
 *
 * Tickets expire, so this must be re-run on every (re)connect rather than
 * cached for the lifetime of the PTY.
 */
export async function requestPtyConnectTicket(
  client: OpenCodeClient,
  ptyId: string,
  directory: string,
): Promise<PtyConnectTicket> {
  const result = await withOpenCodeErrors(() =>
    client.pty.connect.token({
      ptyID: ptyId,
      ...withLocation(directory),
      "x-opencode-ticket": "1",
    }),
  );

  const { ticket, expires_in: expiresIn } = result.data;
  if (!ticket) {
    throw toOpenCodeError(
      new Error("OpenCode returned an empty PTY connect ticket."),
    );
  }

  return { ticket, expiresIn: expiresIn ?? 0 };
}

/**
 * Tracks one PTY for the terminal panel.
 *
 * ## Ownership
 *
 * A PTY found by `pty.list` may have been started by this device *or by somebody
 * else* - another client, or a shell the user left running yesterday. The two are
 * treated differently on purpose:
 *
 * - **Owned** PTYs (created here) are this device's to delete. Deleting them is
 *   what stops shells accumulating on the server.
 * - **Adopted** PTYs are never deleted automatically. Killing a session this
 *   device did not start would destroy work someone else is relying on.
 *
 * `dispose()` is the one path that deletes regardless, and it is only ever
 * reached from an explicit user action.
 *
 * ## Why not delete on unmount
 *
 * The panel unmounts every time the user switches back to the chat, and the
 * shell is per-directory rather than per-panel. Deleting on unmount would throw
 * away the user's shell - its working directory, its running build, its history -
 * on every tab switch. That is a far worse failure than a lingering PTY, so the
 * cleanup is driven by explicit intent instead: a shell preference change, an
 * explicit kill, and pruning dead records on sight.
 */
export function usePtySession(
  directory: string | null | undefined,
  shell: TerminalShell = "auto",
) {
  const { client, status: connectionStatus } = useConnection();
  const [ptyId, setPtyId] = useState<string | null>(null);
  const [status, setStatus] = useState<PtySessionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const retryCount = useRef(0);

  /**
   * PTY ids this device created, per directory.
   *
   * A map rather than a single ref because switching worktrees must not make the
   * client forget - and therefore orphan - the shell it started in the previous
   * one.
   */
  const ownedPtys = useRef<Map<string, Set<string>>>(new Map());

  /** The shell the currently attached PTY was started with, when we own it. */
  const ownedShell = useRef<TerminalShell | null>(null);

  const rememberOwned = useCallback((directory: string, id: string) => {
    const forDirectory = ownedPtys.current.get(directory) ?? new Set<string>();
    forDirectory.add(id);
    ownedPtys.current.set(directory, forDirectory);
  }, []);

  const forgetOwned = useCallback((directory: string, id: string) => {
    const forDirectory = ownedPtys.current.get(directory);
    if (!forDirectory) return;
    forDirectory.delete(id);
    if (forDirectory.size === 0) {
      ownedPtys.current.delete(directory);
    }
  }, []);

  /**
   * Removes PTYs from the server.
   *
   * Failures are swallowed on purpose. The only realistic errors are "already
   * gone" and "connection lost", and both are outcomes the caller wanted. A
   * cleanup path that throws would turn a tidy shutdown into an error state and
   * could block the caller from recording its own progress.
   */
  const removePtys = useCallback(
    async (directory: string, ids: readonly string[]) => {
      if (!client || ids.length === 0) return;

      await Promise.all(
        ids.map(async (id) => {
          try {
            await withOpenCodeErrors(() =>
              client.pty.remove({ ptyID: id, ...withLocation(directory) }),
            );
          } catch {
            // Already gone, or the server is unreachable. Either way there is
            // nothing left to clean up on this id.
          }
          forgetOwned(directory, id);
        }),
      );
    },
    [client, forgetOwned],
  );

  const retry = useCallback(() => {
    retryCount.current += 1;
    setPtyId(null);
    setStatus("loading");
    setError(null);
  }, []);

  useEffect(() => {
    if (!client || connectionStatus !== "connected" || !directory) {
      return;
    }

    let cancelled = false;
    const attempt = retryCount.current;
    const ownedHere = ownedPtys.current.get(directory);

    const ensurePty = async () => {
      if (attempt !== retryCount.current) return;

      // A shell preference change only invalidates a PTY *this device* started.
      // An adopted shell is left running regardless, because it is not ours to
      // recycle and the user may be mid-something in it.
      const ownedId = ownedHere?.has(ptyId ?? "") ? ptyId : null;
      const replaceOwned =
        ownedId !== null &&
        ownedShell.current !== null &&
        ownedShell.current !== shell;

      // The ready short-circuit has to come *after* the shell check, which
      // `shouldKeepSession` makes explicit. `shell` is a dependency of this effect,
      // so a preference change re-runs it; returning early on `status === "ready"`
      // first would swallow the change and leave the setting permanently inert.
      if (shouldKeepSession({ phase: status, ptyId, replaceOwned })) return;

      setStatus("loading");
      setError(null);

      try {
        // V2 location scope replaces the V1 `?directory=` query parameter, and
        // the response comes back as `{ location, data }` directly (the client
        // throws on failure rather than returning an `{ data, error }`
        // envelope).
        const listed = await withOpenCodeErrors(() =>
          client.pty.list(withLocation(directory)),
        );

        if (cancelled || attempt !== retryCount.current) return;

        const ptys: Pty[] = listed.data ?? [];

        const plan = planPtyLifecycle({
          ptys,
          ownedId,
          replaceOwned,
        });

        if (cancelled || attempt !== retryCount.current) return;

        // Dead records go first so the list stays navigable. Best-effort.
        void removePtys(directory, plan.pruneIds);

        if (plan.reuseId) {
          // Adopted rather than owned: remember that it is not ours to delete.
          ownedShell.current = null;
          setPtyId(plan.reuseId);
          setStatus("ready");
          return;
        }

        const created = await withOpenCodeErrors(() =>
          client.pty.create({
            ...withLocation(directory),
            cwd: directory,
            title: "Desk Escape",
            ...(shell !== "auto" ? { command: shell } : {}),
          }),
        );

        // Ownership is recorded *before* the cancellation guard, not after.
        // The create has already happened on the server whether or not this
        // attempt is still the one we want, so an abandoned attempt still leaves a
        // real shell running. Recording it later would mean a cancelled create is
        // orphaned forever - untracked, so no cleanup path can ever reach it.
        if (created.data?.id) {
          rememberOwned(directory, created.data.id);
        }

        if (cancelled || attempt !== retryCount.current) return;

        if (!created.data?.id) {
          throw new Error("OpenCode did not return a PTY session id.");
        }

        ownedShell.current = shell;
        setPtyId(created.data.id);
        setStatus("ready");
      } catch (caught) {
        if (cancelled || attempt !== retryCount.current) return;

        setPtyId(null);
        setStatus("error");
        setError(toOpenCodeError(caught).message);
      }
    };

    void ensurePty();

    return () => {
      cancelled = true;
    };
  }, [
    client,
    connectionStatus,
    directory,
    shell,
    ptyId,
    status,
    rememberOwned,
    removePtys,
  ]);

  /**
   * Ends the current shell, whether or not this device started it.
   *
   * Wired to an explicit "Kill shell" action. This is the only path that
   * deletes an adopted PTY, and it exists so the user has a way out when a shell
   * they did not start is holding the slot.
   */
  const dispose = useCallback(async () => {
    if (!directory || !ptyId) {
      return false;
    }
    await removePtys(directory, [ptyId]);
    ownedShell.current = null;
    retryCount.current += 1;
    setPtyId(null);
    setStatus("idle");
    setError(null);
    return true;
  }, [directory, ptyId, removePtys]);

  /** PTY ids this device created and has not yet removed, across directories. */
  const ownedPtyIds = useCallback(
    () =>
      [...ownedPtys.current.entries()].flatMap(([dir, ids]) =>
        [...ids].map((id) => ({ directory: dir, id })),
      ),
    [],
  );

  return {
    ptyId,
    status,
    error,
    retry,
    dispose,
    ownedPtyIds,
    reset: () => {
      setPtyId(null);
      setStatus("idle");
      setError(null);
      retryCount.current += 1;
    },
  };
}
