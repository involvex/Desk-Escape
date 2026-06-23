import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { Command, Config, Session } from "@opencode-ai/sdk/client";
import {
  applyStreamEvent,
  isAgentBusyEvent,
  shouldRefetchMessages,
} from "@/api/message-stream";
import { withDirectoryQuery } from "@/api/directory";
import { fetchProjectList } from "@/api/client";
import { useConnection } from "@/context/ConnectionContext";
import type { MessageWithParts } from "@/types/opencode";

export const sessionMessagesKey = (sessionId: string) =>
  ["session", sessionId, "messages"] as const;

export const sessionsKey = (directory?: string | null) =>
  ["sessions", directory ?? "default"] as const;

export const projectsKey = ["projects"] as const;

export const commandsKey = (directory?: string | null) =>
  ["commands", directory ?? "default"] as const;

export const configKey = ["opencode-config"] as const;

async function fetchSessionMessages(
  client: NonNullable<ReturnType<typeof useConnection>["client"]>,
  sessionId: string,
  directory?: string | null,
): Promise<MessageWithParts[]> {
  const result = await client.session.messages({
    path: { id: sessionId },
    ...withDirectoryQuery(directory),
  });

  return (result.data ?? []) as MessageWithParts[];
}

export function useSessions() {
  const { client, activeDirectory } = useConnection();

  return useQuery({
    enabled: Boolean(client),
    queryKey: sessionsKey(activeDirectory),
    queryFn: async (): Promise<Session[]> => {
      if (!client) {
        return [];
      }

      const result = await client.session.list(
        withDirectoryQuery(activeDirectory),
      );
      return result.data ?? [];
    },
    staleTime: 30_000,
  });
}

export function useProjects() {
  const { client } = useConnection();

  return useQuery({
    enabled: Boolean(client),
    queryKey: projectsKey,
    queryFn: async () => {
      if (!client) {
        return [];
      }
      return fetchProjectList(client);
    },
    staleTime: 60_000,
  });
}

export function useCurrentProject() {
  const { client, activeDirectory } = useConnection();

  return useQuery({
    enabled: Boolean(client),
    queryKey: ["project", "current", activeDirectory ?? "default"],
    queryFn: async () => {
      if (!client) {
        return null;
      }
      const result = await client.project.current(
        withDirectoryQuery(activeDirectory),
      );
      return result.data ?? null;
    },
    staleTime: 60_000,
  });
}

export function useCommands() {
  const { client, activeDirectory } = useConnection();

  return useQuery({
    enabled: Boolean(client),
    queryKey: commandsKey(activeDirectory),
    queryFn: async (): Promise<Command[]> => {
      if (!client) {
        return [];
      }
      const result = await client.command.list(
        withDirectoryQuery(activeDirectory),
      );
      return result.data ?? [];
    },
    staleTime: 120_000,
  });
}

export function useOpenCodeConfig() {
  const { client } = useConnection();

  return useQuery({
    enabled: Boolean(client),
    queryKey: configKey,
    queryFn: async (): Promise<Config | null> => {
      if (!client) {
        return null;
      }
      const result = await client.config.get();
      return result.data ?? null;
    },
    staleTime: 30_000,
  });
}

export function useUpdateConfig() {
  const queryClient = useQueryClient();
  const { client } = useConnection();

  return useMutation({
    mutationFn: async (body: Config) => {
      if (!client) {
        throw new Error("Not connected.");
      }
      const result = await client.config.update({ body });
      return result.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: configKey });
      void queryClient.invalidateQueries({ queryKey: ["commands"] });
    },
  });
}

export function useSessionMessages(sessionId: string | null) {
  const { client, activeDirectory } = useConnection();

  return useQuery({
    enabled: Boolean(client && sessionId),
    queryKey: sessionId ? sessionMessagesKey(sessionId) : ["session", "none"],
    queryFn: async () => {
      if (!client || !sessionId) {
        return [];
      }
      return fetchSessionMessages(client, sessionId, activeDirectory);
    },
    staleTime: Infinity,
    refetchOnMount: "always",
  });
}

export function useFileList(path: string) {
  const { client, activeDirectory } = useConnection();

  return useQuery({
    enabled: Boolean(client),
    queryKey: ["file-list", activeDirectory ?? "default", path],
    queryFn: async () => {
      if (!client) {
        return [];
      }

      const result = await client.file.list({
        query: {
          path,
          ...(activeDirectory ? { directory: activeDirectory } : {}),
        },
      });

      return result.data ?? [];
    },
  });
}

export function useFileStatus() {
  const { client, activeDirectory } = useConnection();

  return useQuery({
    enabled: Boolean(client),
    queryKey: ["file-status", activeDirectory ?? "default"],
    queryFn: async () => {
      if (!client) {
        return [];
      }

      const result = await client.file.status(
        withDirectoryQuery(activeDirectory),
      );
      return result.data ?? [];
    },
    refetchInterval: 30_000,
  });
}

export function useFilePatch(path: string | null) {
  const { client, activeDirectory } = useConnection();

  return useQuery({
    enabled: Boolean(client && path),
    queryKey: ["file-patch", activeDirectory ?? "default", path],
    queryFn: async () => {
      if (!client || !path) {
        return null;
      }

      const result = await client.file.read({
        query: {
          path,
          ...(activeDirectory ? { directory: activeDirectory } : {}),
        },
      });

      return result.data ?? null;
    },
  });
}

export function useSendPrompt(sessionId: string | null) {
  const queryClient = useQueryClient();
  const {
    client,
    activeDirectory,
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
        ...withDirectoryQuery(activeDirectory),
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

      const messages = await fetchSessionMessages(
        client,
        sessionId,
        activeDirectory,
      );
      queryClient.setQueryData(sessionMessagesKey(sessionId), messages);
      setAgentActive(false);
    },
  });
}

export function useExecuteCommand(sessionId: string | null) {
  const queryClient = useQueryClient();
  const { client, activeDirectory, setAgentActive } = useConnection();

  return useMutation({
    mutationFn: async (input: { command: string; arguments?: string }) => {
      if (!client || !sessionId) {
        throw new Error("No active session.");
      }

      setAgentActive(true);

      const result = await client.session.command({
        path: { id: sessionId },
        ...withDirectoryQuery(activeDirectory),
        body: {
          command: input.command,
          arguments: input.arguments ?? "",
        },
      });

      return result.data;
    },
    onSettled: async () => {
      if (!client || !sessionId) {
        setAgentActive(false);
        return;
      }

      const messages = await fetchSessionMessages(
        client,
        sessionId,
        activeDirectory,
      );
      queryClient.setQueryData(sessionMessagesKey(sessionId), messages);
      setAgentActive(false);
    },
  });
}

export function useSessionMessageStream(sessionId: string | null) {
  const queryClient = useQueryClient();
  const { client, activeDirectory, setAgentActive } = useConnection();

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
            const messages = await fetchSessionMessages(
              client,
              sessionId,
              activeDirectory,
            );
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
  }, [activeDirectory, client, queryClient, sessionId, setAgentActive]);
}
