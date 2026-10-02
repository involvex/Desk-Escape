import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { OpenCodeClient, V2Event } from "@opencode/client";

import {
  applyStreamEvent,
  isAgentBusyEvent,
  shouldRefetchMessages,
} from "@/api/message-stream";
import { withLocation } from "@/api/opencode/location";
import { withOpenCodeErrors } from "@/api/opencode/errors";
import {
  toChatMessages,
  toFileEntry,
  toModel,
  toProvider,
  toSession,
} from "@/api/opencode/adapter";
import { useConnection } from "@/context/ConnectionContext";
import type {
  Agent,
  ChatMessage,
  Command,
  Model,
  Provider,
  Session,
} from "@/types/domain";
import { resolveConfig } from "@/api/opencode/config";
import type { OpenCodeConfig } from "@/api/opencode/config";

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

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/**
 * Fetch a session's transcript.
 *
 * V2 moved this off `session.messages` onto a top-level `message.list`
 * namespace, returns the messages **nested** (no separate parts array), and
 * paginates with a cursor. `order: "asc"` keeps chronological order, matching
 * how the transcript is rendered.
 */
async function fetchSessionMessages(
  client: OpenCodeClient,
  sessionId: string,
): Promise<ChatMessage[]> {
  const messages: Awaited<
    ReturnType<OpenCodeClient["message"]["list"]>
  >["data"] = [];

  let cursor: string | undefined;
  // Follow the cursor to completion; a long session spans several pages.
  do {
    const page = await withOpenCodeErrors(() =>
      client.message.list({
        sessionID: sessionId,
        order: "asc",
        ...(cursor ? { cursor } : {}),
      }),
    );
    messages.push(...page.data);
    cursor = page.cursor?.next ?? undefined;
  } while (cursor);

  return toChatMessages(messages);
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
      const result = await withOpenCodeErrors(() =>
        // `session.list` filters by plain strings, not a `location` object.
        client.session.list({
          ...(activeDirectory ? { directory: activeDirectory } : {}),
        }),
      );
      return result.data.map(toSession);
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
      const projects = await withOpenCodeErrors(() => client.project.list());
      // V2 projects have no `worktree`; expose `location.directory` so the
      // project pickers keep a stable field to switch on.
      return projects.map((project) => ({
        id: project.id,
        name: project.name,
        vcs: project.vcs,
        worktree: project.canonical,
      }));
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
      // V2 removed `project.current()`; `location.get()` resolves the requested
      // location (or the server default) plus its owning project.
      const info = await withOpenCodeErrors(() =>
        client.location.get(withLocation(activeDirectory)),
      );
      return {
        id: info.project.id,
        worktree: info.directory,
        vcs: undefined,
      };
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
      const result = await withOpenCodeErrors(() =>
        client.command.list(withLocation(activeDirectory)),
      );
      return result.data;
    },
    staleTime: 120_000,
  });
}

// ---------------------------------------------------------------------------
// Agents and models
//
// V2 exposes these as first-class endpoints. The previous implementation scraped
// `config.get()` and fabricated `Agent`/`Model` objects from V1 config shapes,
// which lost fields and silently dropped models the server knows about.
// ---------------------------------------------------------------------------

export function useAgents() {
  const { client, activeDirectory } = useConnection();

  return useQuery({
    enabled: Boolean(client),
    queryKey: agentsKey(activeDirectory),
    queryFn: async (): Promise<Agent[]> => {
      if (!client) {
        return [];
      }
      const result = await withOpenCodeErrors(() =>
        client.agent.list(withLocation(activeDirectory)),
      );
      return result.data
        .filter((agent) => !agent.hidden)
        .map((agent) => ({
          // V2 exposes the stable identifier as `id`.
          name: agent.id,
          description: agent.description,
          mode: agent.mode,
          color: agent.color,
          hidden: agent.hidden,
          model: agent.model
            ? {
                providerID: agent.model.providerID,
                modelID: agent.model.id,
                variant: agent.model.variant,
              }
            : undefined,
        }));
    },
    staleTime: 60_000,
  });
}

export function useModels() {
  const { client, activeDirectory } = useConnection();

  return useQuery({
    enabled: Boolean(client),
    queryKey: modelsKey(activeDirectory),
    queryFn: async (): Promise<Model[]> => {
      if (!client) {
        return [];
      }
      const result = await withOpenCodeErrors(() =>
        client.model.list(withLocation(activeDirectory)),
      );
      return result.data.map(toModel);
    },
    staleTime: 60_000,
  });
}

export function useProviders() {
  const { client, activeDirectory } = useConnection();

  return useQuery({
    enabled: Boolean(client),
    queryKey: modelsKey(activeDirectory),
    queryFn: async (): Promise<Provider[]> => {
      if (!client) {
        return [];
      }
      const [providers, modelList] = await Promise.all([
        withOpenCodeErrors(() =>
          client.provider.list(withLocation(activeDirectory)),
        ),
        withOpenCodeErrors(() =>
          client.model.list(withLocation(activeDirectory)),
        ),
      ]);
      const models = modelList.data.map(toModel);
      return providers.data.map((provider) => toProvider(provider, models));
    },
    staleTime: 60_000,
  });
}

/**
 * The session's active agent.
 *
 * `SessionInfo` now carries `agent` directly, so this reads real state instead
 * of falling back to whichever agent happened to be listed first.
 */
export function useCurrentAgent(sessionId?: string | null) {
  const { client } = useConnection();
  const activeSession = useConnection().sessionId ?? sessionId;

  return useQuery({
    enabled: Boolean(client && activeSession),
    queryKey: ["session", "current-agent", activeSession],
    queryFn: async (): Promise<Agent | null> => {
      if (!client || !activeSession) {
        return null;
      }
      const info = await withOpenCodeErrors(() =>
        client.session.get({ sessionID: activeSession }),
      );
      if (!info.agent) {
        return null;
      }
      const { data } = await withOpenCodeErrors(() =>
        client.agent.get({ agentID: info.agent!, ...withLocation() }),
      );
      return {
        name: data.id,
        description: data.description,
        mode: data.mode,
        color: data.color,
        hidden: data.hidden,
        model: data.model
          ? {
              providerID: data.model.providerID,
              modelID: data.model.id,
              variant: data.model.variant,
            }
          : undefined,
      };
    },
    staleTime: 30_000,
  });
}

/** The session's active model, resolved against the server's model catalogue. */
export function useCurrentModel(sessionId?: string | null) {
  const { client, activeDirectory } = useConnection();
  const activeSession = useConnection().sessionId ?? sessionId;

  return useQuery({
    enabled: Boolean(client && activeSession),
    queryKey: ["session", "current-model", activeSession],
    queryFn: async (): Promise<Model | null> => {
      if (!client || !activeSession) {
        return null;
      }
      const info = await withOpenCodeErrors(() =>
        client.session.get({ sessionID: activeSession }),
      );
      const ref = info.model;
      if (!ref) {
        return null;
      }
      // Scope the catalogue lookup to the same location as every other query.
      // The model catalogue is location-dependent (per-project overrides), so
      // resolving against the server default would pick the wrong model in a
      // multi-directory setup.
      const models = await withOpenCodeErrors(() =>
        client.model.list(withLocation(activeDirectory)),
      );
      const match = models.data.find(
        (candidate) =>
          candidate.providerID === ref.providerID &&
          (candidate.id === ref.id || candidate.modelID === ref.id),
      );
      return match ? toModel(match) : null;
    },
    staleTime: 30_000,
  });
}

export function useSwitchModel() {
  const queryClient = useQueryClient();
  const { client, sessionId } = useConnection();

  return useMutation({
    mutationFn: async (input: { model: Model }) => {
      if (!client || !sessionId) {
        throw new Error("No active session.");
      }
      // V2 removed `model` from the prompt body: model is session state and is
      // switched explicitly.
      await withOpenCodeErrors(() =>
        client.session.switchModel({
          sessionID: sessionId,
          model: {
            id: input.model.id,
            providerID: input.model.providerID,
            ...(input.model.variants?.length
              ? { variant: input.model.variants[0] }
              : {}),
          },
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["session", "current-model", sessionId],
      });
    },
  });
}

export function useSwitchAgent() {
  const queryClient = useQueryClient();
  const { client, sessionId } = useConnection();

  return useMutation({
    mutationFn: async (input: { agent: string }) => {
      if (!client || !sessionId) {
        throw new Error("No active session.");
      }
      await withOpenCodeErrors(() =>
        client.session.switchAgent({
          sessionID: sessionId,
          agent: input.agent,
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["session", "current-agent", sessionId],
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export function useOpenCodeConfig() {
  const { client, activeDirectory } = useConnection();

  return useQuery({
    enabled: Boolean(client),
    queryKey: configKey,
    queryFn: async (): Promise<OpenCodeConfig | null> => {
      if (!client) {
        return null;
      }
      // V2 returns the list of source documents (lowest priority first), not a
      // merged config, so fold them here.
      const entries = await withOpenCodeErrors(() =>
        client.config.get(withLocation(activeDirectory)),
      );
      return resolveConfig(entries);
    },
    staleTime: 30_000,
  });
}

/**
 * V2's `config.update` patches exactly one field: `shell`. Everything else is
 * read-only over the API, so this deliberately exposes only that.
 */
export function useUpdateShell() {
  const queryClient = useQueryClient();
  const { client } = useConnection();

  return useMutation({
    mutationFn: async (shell: string | null) => {
      if (!client) {
        throw new Error("Not connected.");
      }
      await withOpenCodeErrors(() => client.config.update({ shell }));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: configKey });
    },
  });
}

// ---------------------------------------------------------------------------
// Files
//
// V2 flattens the file tree: `file.list` returns a single level of
// `{ path, type }` entries with no `children` and no `size`, and it no longer
// includes file contents. Directory traversal re-calls `file.list` with a new
// `path`; the display name is derived from the path.
// ---------------------------------------------------------------------------

export function useFileList(path: string) {
  const { client, activeDirectory } = useConnection();

  return useQuery({
    enabled: Boolean(client),
    queryKey: ["file-list", activeDirectory ?? "default", path],
    queryFn: async () => {
      if (!client) {
        return [];
      }
      const result = await withOpenCodeErrors(() =>
        client.file.list({ ...withLocation(activeDirectory), path }),
      );
      return result.data.map(toFileEntry);
    },
  });
}

/**
 * Dirty-file status for the active location.
 *
 * V1 had `client.file.status()`, which V2 replaced with `client.vcs.status()`.
 * That returns an **array** of `{ file, additions, deletions, status }` where
 * status is only `added | deleted | modified` -- there is **no `untracked`**, so
 * files not yet in git are invisible here. Consumers that show the working tree
 * must backfill those by diffing against `useFileList`.
 */
export function useFileStatus() {
  const { client, activeDirectory } = useConnection();

  return useQuery({
    enabled: Boolean(client),
    queryKey: ["file-status", activeDirectory ?? "default"],
    queryFn: async () => {
      if (!client) {
        return [];
      }
      const result = await withOpenCodeErrors(() =>
        client.vcs.status(withLocation(activeDirectory)),
      );
      return result.data;
    },
    refetchInterval: 30_000,
  });
}

/**
 * The diff for a single path.
 *
 * V1 read this off `file.read(...).data.diff`; that field does not exist in
 * V2, whose `file.read` returns a bare `Uint8Array`. Diffs now come from
 * `vcs.diff`, which returns every changed file, so this filters down to one.
 */
export function useFilePatch(path: string | null) {
  const { client, activeDirectory } = useConnection();

  return useQuery({
    enabled: Boolean(client && path),
    queryKey: ["file-patch", activeDirectory ?? "default", path],
    queryFn: async () => {
      if (!client || !path) {
        return null;
      }
      const result = await withOpenCodeErrors(() =>
        client.vcs.diff({
          ...withLocation(activeDirectory),
          mode: "working",
        }),
      );
      return result.data.find((entry) => entry.file === path) ?? null;
    },
  });
}

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

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

      setAgentActive(true);

      // V2's prompt body is flat: `text` plus optional `files`/`agents`/
      // `skills`, with no `parts` array and no `model`/`agent` fields.
      const prefix = contextAttachments
        .map((attachment) => `Context attachment: ${attachment.path}\n`)
        .join("");

      const result = await withOpenCodeErrors(() =>
        client.session.prompt({
          sessionID: sessionId,
          text: prefix + text,
          delivery: "steer",
        }),
      );

      clearContextAttachments();
      return result;
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

export function useExecuteCommand(sessionId: string | null) {
  const queryClient = useQueryClient();
  const { client, setAgentActive } = useConnection();

  return useMutation({
    mutationFn: async (input: { command: string; arguments?: string }) => {
      if (!client || !sessionId) {
        throw new Error("No active session.");
      }

      setAgentActive(true);

      // V1 sent `{ command, arguments }`; V2 sends `{ name, text }`.
      await withOpenCodeErrors(() =>
        client.session.command({
          sessionID: sessionId,
          name: input.command,
          text: input.arguments ?? "",
          delivery: "steer",
        }),
      );
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
  const { client, eventBus, setAgentActive } = useConnection();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!client || !sessionId || !eventBus) return;

    const unsubscribe = eventBus.onEvent((raw: unknown) => {
      const event = raw as V2Event;

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

      const base = queryClient.getQueryData<ChatMessage[]>(
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

export { fetchSessionMessages };
