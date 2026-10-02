import { useCallback, useEffect, useRef, useState } from "react";
import type { OpenCodeClient, Pty } from "@opencode/client";
import { useConnection } from "@/context/ConnectionContext";
import { toOpenCodeError, withOpenCodeErrors } from "@/api/opencode/errors";
import { withLocation } from "@/api/opencode/location";
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

export function usePtySession(
  directory: string | null | undefined,
  shell: TerminalShell = "auto",
) {
  const { client, status: connectionStatus } = useConnection();
  const [ptyId, setPtyId] = useState<string | null>(null);
  const [status, setStatus] = useState<PtySessionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const retryCount = useRef(0);

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

    const ensurePty = async () => {
      if (attempt !== retryCount.current) return;
      if (status === "ready" && ptyId) return;

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

        // The V2 `Pty` record has no `name`; reuse is decided by `status`. The
        // list is already scoped to `directory` via the location parameter, so
        // no extra `cwd` comparison is needed (and normalizing it here would
        // risk spawning duplicates when the server rewrites the path).
        const running: Pty | undefined = (listed.data ?? []).find(
          (pty) => pty.status === "running",
        );

        if (cancelled || attempt !== retryCount.current) return;

        if (running) {
          setPtyId(running.id);
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

        if (cancelled || attempt !== retryCount.current) return;

        if (!created.data?.id) {
          throw new Error("OpenCode did not return a PTY session id.");
        }

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
  }, [client, connectionStatus, directory, shell, ptyId, status]);

  return {
    ptyId,
    status,
    error,
    retry,
    reset: () => {
      setPtyId(null);
      setStatus("idle");
      setError(null);
      retryCount.current += 1;
    },
  };
}
