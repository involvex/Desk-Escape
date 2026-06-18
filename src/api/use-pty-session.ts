import { useCallback, useEffect, useState } from "react";
import { useConnection } from "@/context/ConnectionContext";

export type PtySessionStatus = "idle" | "loading" | "ready" | "error";

export function usePtySession(directory: string | null | undefined) {
  const { client, status: connectionStatus } = useConnection();
  const [ptyId, setPtyId] = useState<string | null>(null);
  const [status, setStatus] = useState<PtySessionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!client || connectionStatus !== "connected" || !directory) {
      return;
    }

    let cancelled = false;

    const ensurePty = async () => {
      setStatus("loading");
      setError(null);

      try {
        const listResult = await client.pty.list({
          query: { directory },
        });

        const running = (listResult.data ?? []).find(
          (pty) => pty.status === "running",
        );

        if (cancelled) {
          return;
        }

        if (running) {
          setPtyId(running.id);
          setStatus("ready");
          return;
        }

        const createResult = await client.pty.create({
          query: { directory },
          body: {
            cwd: directory,
            title: "Desk Escape",
          },
        });

        if (cancelled) {
          return;
        }

        if (!createResult.data?.id) {
          throw new Error("OpenCode did not return a PTY session id.");
        }

        setPtyId(createResult.data.id);
        setStatus("ready");
      } catch (caught) {
        if (cancelled) {
          return;
        }

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
  }, [attempt, client, connectionStatus, directory]);

  return {
    ptyId,
    status,
    error,
    retry,
  };
}
