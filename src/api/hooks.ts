import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type {
  Agent,
  AgentConfig,
  AssistantMessage,
  Command,
  Config,
  EventSubscribeResponse,
  Model,
  Provider,
  ProviderConfig,
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

type ConfigModel = NonNullable<NonNullable<ProviderConfig["models"]>[string]>;

function transformConfigModel(
  modelId: string,
  config: ConfigModel,
  providerId: string,
): Model {
  const modalities = config.modalities ?? {
    input: ["text" as const],
    output: ["text" as const],
  };
  const inputModalities = modalities.input ?? [];
  const outputModalities = modalities.output ?? [];

  return {
    id: config.id ?? modelId,
    providerID: providerId,
    api: {
      id: config.id ?? modelId,
      url: "",
      npm: config.provider?.npm ?? "",
    },
    name: config.name ?? modelId,
    capabilities: {
      temperature: config.temperature ?? false,
      reasoning: config.reasoning ?? false,
      attachment: config.attachment ?? false,
      toolcall: config.tool_call ?? false,
      input: {
        text: inputModalities.includes("text"),
        audio: inputModalities.includes("audio"),
        image: inputModalities.includes("image"),
        video: inputModalities.includes("video"),
        pdf: inputModalities.includes("pdf"),
      },
      output: {
        text: outputModalities.includes("text"),
        audio: outputModalities.includes("audio"),
        image: outputModalities.includes("image"),
        video: outputModalities.includes("video"),
        pdf: outputModalities.includes("pdf"),
      },
    },
    cost: config.cost
      ? {
          input: config.cost.input,
          output: config.cost.output,
          cache: {
            read: config.cost.cache_read ?? 0,
            write: config.cost.cache_write ?? 0,
          },
          ...(config.cost.context_over_200k
            ? {
                experimentalOver200K: {
                  input: config.cost.context_over_200k.input,
                  output: config.cost.context_over_200k.output,
                  cache: {
                    read: config.cost.context_over_200k.cache_read ?? 0,
                    write: config.cost.context_over_200k.cache_write ?? 0,
                  },
                },
              }
            : {}),
        }
      : {
          input: 0,
          output: 0,
          cache: { read: 0, write: 0 },
        },
    limit: config.limit ?? { context: 0, output: 0 },
    status: config.status ?? "active",
    options: config.options ?? {},
    headers: config.headers ?? {},
  };
}

function transformAgentConfig(key: string, config: AgentConfig): Agent {
  const modelStr = config.model;
  let parsedModel: { providerID: string; modelID: string } | undefined;
  if (typeof modelStr === "string" && modelStr.includes("/")) {
    const parts = modelStr.split("/");
    const providerID = parts[0]!;
    const modelID = parts[1]!;
    if (providerID && modelID) {
      parsedModel = { providerID, modelID };
    }
  }

  return {
    name: config.name ?? key,
    description: config.description,
    mode: config.mode ?? "primary",
    builtIn: false,
    topP: config.top_p,
    temperature: config.temperature,
    color: config.color,
    model: parsedModel,
    prompt: config.prompt,
    tools: config.tools ?? {},
    options: {},
    maxSteps: config.maxSteps,
  } as Agent;
}

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
      const agents: Record<string, Agent> = {};
      for (const [key, value] of Object.entries(agentConfig)) {
        if (value) {
          agents[key] = transformAgentConfig(key, value);
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
      const providers: Record<string, Provider> = {};
      for (const [key, value] of Object.entries(providerConfig)) {
        if (value && value.models) {
          const models: Record<string, Model> = {};
          for (const [modelId, modelConfig] of Object.entries(value.models)) {
            if (!modelConfig) continue;
            models[modelId] = transformConfigModel(modelId, modelConfig, key);
          }
          providers[key] = {
            id: key,
            name: value.name ?? key,
            source: "config",
            env: value.env ?? [],
            options: value.options ?? {},
            models,
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
      await client.session.get({
        path: { id: sessionId },
        ...withDirectoryQuery(activeDirectory),
      });

      // For now, return the first agent as default
      // In the future, we could track which agent was used in the session
      const firstAgentKey = agentKeys[0];
      if (!firstAgentKey) return null;
      const firstAgentConfig = agents[firstAgentKey];
      if (!firstAgentConfig) return null;
      return transformAgentConfig(firstAgentKey, firstAgentConfig);
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
        const modelConfig = provider?.models?.[modelId];
        if (modelConfig) {
          return {
            providerId,
            model: transformConfigModel(modelId, modelConfig, providerId),
          };
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
          const modelConfig = provider?.models?.[modelId];
          if (modelConfig) {
            return {
              providerId,
              model: transformConfigModel(modelId, modelConfig, providerId),
            };
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
