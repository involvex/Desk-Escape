import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type {
  Agent,
  AssistantMessage,
  Command,
  Config,
  EventSubscribeResponse,
  Model,
  Provider,
  Session,
} from "@opencode-ai/sdk/client";
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

export const agentsKey = (directory?: string | null) =>
  ["agents", directory ?? "default"] as const;

export const modelsKey = (directory?: string | null) =>
  ["models", directory ?? "default"] as const;

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

export function useAgents() {
  const { client, activeDirectory } = useConnection();

  return useQuery({
    enabled: Boolean(client),
    queryKey: agentsKey(activeDirectory),
    queryFn: async (): Promise<Record<string, Agent>> => {
      if (!client) {
        return {};
      }
      const result = await client.config.get(
        withDirectoryQuery(activeDirectory),
      );
      const agentConfig = result.data?.agent ?? {};
      // Convert AgentConfig to Agent (filter out undefined)
      const agents: Record<string, Agent> = {};
      for (const [key, value] of Object.entries(agentConfig)) {
        if (value) {
          agents[key] = value as Agent;
        }
      }
      return agents;
    },
    staleTime: 60_000,
  });
}

export function useModels() {
  const { client, activeDirectory } = useConnection();

  return useQuery({
    enabled: Boolean(client),
    queryKey: modelsKey(activeDirectory),
    queryFn: async (): Promise<Record<string, Provider>> => {
      if (!client) {
        return {};
      }
      const result = await client.config.get(
        withDirectoryQuery(activeDirectory),
      );
      const providerConfig = result.data?.provider ?? {};
      // Convert ProviderConfig to Provider (filter out undefined)
      const providers: Record<string, Provider> = {};
      for (const [key, value] of Object.entries(providerConfig)) {
        if (value && value.models) {
          providers[key] = {
            id: key,
            name: value.name ?? key,
            source: "config",
            env: value.env ?? [],
            options: value.options ?? {},
            models: value.models as Record<string, Model>,
          };
        }
      }
      return providers;
    },
    staleTime: 60_000,
  });
}

export function useCurrentAgent() {
  const { client, sessionId, activeDirectory } = useConnection();

  return useQuery({
    enabled: Boolean(client && sessionId),
    queryKey: ["session", "current-agent", sessionId],
    queryFn: async (): Promise<Agent | null> => {
      if (!client || !sessionId) {
        return null;
      }
      const configResult = await client.config.get(
        withDirectoryQuery(activeDirectory),
      );
      const agents = configResult.data?.agent ?? {};
      const agentKeys = Object.keys(agents);
      if (agentKeys.length === 0) return null;

      // Try to get agent from session
      const sessionResult = await client.session.get({
        path: { id: sessionId },
        ...withDirectoryQuery(activeDirectory),
      });

      // For now, return the first agent as default
      // In the future, we could track which agent was used in the session
      const firstAgentKey = agentKeys[0];
      return firstAgentKey ? (agents[firstAgentKey] as Agent) : null;
    },
    staleTime: 30_000,
  });
}

export function useCurrentModel() {
  const { client, sessionId, activeDirectory } = useConnection();

  return useQuery({
    enabled: Boolean(client && sessionId),
    queryKey: ["session", "current-model", sessionId],
    queryFn: async (): Promise<{ providerId: string; model: Model } | null> => {
      if (!client || !sessionId) {
        return null;
      }
      const configResult = await client.config.get(
        withDirectoryQuery(activeDirectory),
      );
      const providers = configResult.data?.provider ?? {};

      // Get model from session's messages (last assistant message)
      const messagesResult = await client.session.messages({
        path: { id: sessionId },
        ...withDirectoryQuery(activeDirectory),
      });
      const messages = messagesResult.data ?? [];
      const lastAssistant = [...messages]
        .reverse()
        .find((m) => m.info.role === "assistant") as
        { info: AssistantMessage; parts: unknown[] } | undefined;

      if (lastAssistant) {
        const modelId = lastAssistant.info.modelID;
        const providerId = lastAssistant.info.providerID;
        const provider = providers[providerId];
        if (provider && provider.models && provider.models[modelId]) {
          return { providerId, model: provider.models[modelId] as Model };
        }
      }

      // Fallback to config default model
      const defaultModel = configResult.data?.model;
      if (defaultModel) {
        const parts = defaultModel.split("/");
        const providerId = parts[0];
        const modelId = parts[1];
        if (providerId && modelId) {
          const provider = providers[providerId];
          if (provider && provider.models && provider.models[modelId]) {
            return { providerId, model: provider.models[modelId] as Model };
          }
        }
      }

      return null;
    },
    staleTime: 30_000,
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
  const { client, eventBus, setAgentActive } = useConnection();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!client || !sessionId || !eventBus) return;

    const unsubscribe = eventBus.onEvent((raw: unknown) => {
      const event = raw as EventSubscribeResponse;

      const busy = isAgentBusyEvent(event);
      if (busy !== null) {
        setAgentActive(busy);
        return;
      }

      if (shouldRefetchMessages(event)) {
        void fetchSessionMessages(client, sessionId).then((messages) => {
          queryClient.setQueryData(sessionMessagesKey(sessionId), messages);
        });
        return;
      }

      const base = queryClient.getQueryData<MessageWithParts[]>(
        sessionMessagesKey(sessionId),
      );
      if (!base) return;

      const updated = applyStreamEvent(base, event, sessionId);
      if (updated) {
        queryClient.setQueryData(sessionMessagesKey(sessionId), updated);
      }
    });

    return unsubscribe;
  }, [client, eventBus, sessionId, queryClient, setAgentActive]);
}
