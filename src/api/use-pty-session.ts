import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection } from "@/context/ConnectionContext";
import type { TerminalShell } from "@/context/PreferencesContext";

export type PtySessionStatus = "idle" | "loading" | "ready" | "error";

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
        const listResult = await client.pty.list({
          query: { directory },
        });

        if (cancelled || attempt !== retryCount.current) return;

        const running = (listResult.data ?? []).find(
          (pty) => pty.status === "running",
        );

        if (cancelled || attempt !== retryCount.current) return;

        if (running) {
          setPtyId(running.id);
          setStatus("ready");
          return;
        }

        const body: Record<string, unknown> = {
          cwd: directory,
          title: "Desk Escape",
        };

        if (shell !== "auto") {
          body.command = shell;
        }

        const createResult = await client.pty.create({
          query: { directory },
          body,
        });

        if (cancelled || attempt !== retryCount.current) return;

        if (!createResult.data?.id) {
          throw new Error("OpenCode did not return a PTY session id.");
        }

        setPtyId(createResult.data.id);
        setStatus("ready");
      } catch (caught) {
        if (cancelled || attempt !== retryCount.current) return;

        setPtyId(null);
        setStatus("error");
        setError(
          caught instanceof Error
            ? caught.message
            : "Failed to start terminal.",
        );
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
