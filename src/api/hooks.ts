import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { Session } from "@opencode-ai/sdk/client";
import {
  applyStreamEvent,
  isAgentBusyEvent,
  shouldRefetchMessages,
} from "@/api/message-stream";
import { useConnection } from "@/context/ConnectionContext";
import type { MessageWithParts } from "@/types/opencode";

export const sessionMessagesKey = (sessionId: string) =>
  ["session", sessionId, "messages"] as const;

export const sessionsKey = ["sessions"] as const;

async function fetchSessionMessages(
  client: NonNullable<ReturnType<typeof useConnection>["client"]>,
  sessionId: string,
): Promise<MessageWithParts[]> {
  const result = await client.session.messages({
    path: { id: sessionId },
  });

  return (result.data ?? []) as MessageWithParts[];
}

export function useSessions() {
  const { client } = useConnection();

  return useQuery({
    enabled: Boolean(client),
    queryKey: sessionsKey,
    queryFn: async (): Promise<Session[]> => {
      if (!client) {
        return [];
      }

      const result = await client.session.list();
      return result.data ?? [];
    },
    staleTime: 30_000,
  });
}

export function useCurrentProject() {
  const { client } = useConnection();

  return useQuery({
    enabled: Boolean(client),
    queryKey: ["project", "current"],
    queryFn: async () => {
      if (!client) {
        return null;
      }
      const result = await client.project.current();
      return result.data ?? null;
    },
    staleTime: 60_000,
  });
}

export function useSessionMessages(sessionId: string | null) {
  const { client } = useConnection();

  return useQuery({
    enabled: Boolean(client && sessionId),
    queryKey: sessionId ? sessionMessagesKey(sessionId) : ["session", "none"],
    queryFn: async () => {
      if (!client || !sessionId) {
        return [];
      }
      return fetchSessionMessages(client, sessionId);
    },
    staleTime: Infinity,
    refetchOnMount: "always",
  });
}

export function useFileList(path: string) {
  const { client } = useConnection();

  return useQuery({
    enabled: Boolean(client),
    queryKey: ["file-list", path],
    queryFn: async () => {
      if (!client) {
        return [];
      }

      const result = await client.file.list({
        query: { path },
      });

      return result.data ?? [];
    },
  });
}

export function useFileStatus() {
  const { client } = useConnection();

  return useQuery({
    enabled: Boolean(client),
    queryKey: ["file-status"],
    queryFn: async () => {
      if (!client) {
        return [];
      }

      const result = await client.file.status();
      return result.data ?? [];
    },
    refetchInterval: 30_000,
  });
}

export function useFilePatch(path: string | null) {
  const { client } = useConnection();

  return useQuery({
    enabled: Boolean(client && path),
    queryKey: ["file-patch", path],
    queryFn: async () => {
      if (!client || !path) {
        return null;
      }

      const result = await client.file.read({
        query: { path },
      });

      return result.data ?? null;
    },
  });
}

export function useSendPrompt(sessionId: string | null) {
  const queryClient = useQueryClient();
  const {
    client,
    setAgentActive,
    clearContextAttachments,
    contextAttachments,
  } = useConnection();

  return useMutation({
    mutationFn: async (text: string) => {
      if (!client || !sessionId) {
        throw new Error("No active session.");
      }

      const attachmentParts = contextAttachments.map((attachment) => ({
        type: "text" as const,
        text: `Context attachment: ${attachment.path}`,
      }));

      setAgentActive(true);

      const result = await client.session.prompt({
        path: { id: sessionId },
        body: {
          parts: [
            ...attachmentParts,
            {
              type: "text",
              text,
            },
          ],
        },
      });

      clearContextAttachments();
      return result.data;
    },
    onSettled: async () => {
      if (!client || !sessionId) {
        setAgentActive(false);
        return;
      }

      const messages = await fetchSessionMessages(client, sessionId);
      queryClient.setQueryData(sessionMessagesKey(sessionId), messages);
      setAgentActive(false);
    },
  });
}

export function useSessionMessageStream(sessionId: string | null) {
  const queryClient = useQueryClient();
  const { client, setAgentActive } = useConnection();

  useEffect(() => {
    if (!client || !sessionId) {
      return;
    }

    let active = true;
    const abort = new AbortController();

    void (async () => {
      try {
        const subscription = await client.event.subscribe({
          signal: abort.signal,
        });

        for await (const event of subscription.stream) {
          if (!active) {
            break;
          }

          const busy = isAgentBusyEvent(event);
          if (busy !== null) {
            setAgentActive(busy);
          }

          if (shouldRefetchMessages(event)) {
            const messages = await fetchSessionMessages(client, sessionId);
            queryClient.setQueryData(sessionMessagesKey(sessionId), messages);
            continue;
          }

          queryClient.setQueryData<MessageWithParts[]>(
            sessionMessagesKey(sessionId),
            (current) => {
              const base = current ?? [];
              const next = applyStreamEvent(base, event, sessionId);
              return next ?? base;
            },
          );
        }
      } catch {
        // SSE may be unavailable on some remote hosts; initial fetch still works.
      }
    })();

    return () => {
      active = false;
      abort.abort();
    };
  }, [client, queryClient, sessionId, setAgentActive]);
}
