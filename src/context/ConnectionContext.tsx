import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import type { OpencodeClient, Project, Session } from "@opencode-ai/sdk/client";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { EventBus } from "@/api/event-bus";
import {
  clearClientCache,
  createAuthenticatedClient,
  createAuthHeader,
  ensureSession,
  fetchCurrentProject,
  testConnection,
} from "@/api/client";
import { useOfflineQueue } from "@/api/use-offline-queue";
import { useReconnect } from "@/api/use-reconnect";
import { CursorProvider } from "@/api/providers/cursor/provider";
import { OpenCodeProvider } from "@/api/providers/opencode/provider";
import type {
  AgentProvider,
  AgentProviderType,
  AnyConnectionConfig,
  CursorConnectionConfig,
} from "@/api/providers/types";
import type {
  ConnectionConfig,
  ConnectionStatus,
  ContextAttachment,
  BasicAuthCredential,
  ConnectionDraft,
  QueuedMessage,
  StoredConnectionConfig,
} from "@/types/opencode";

const CONFIG_STORAGE_KEY = "@desk-escape/connection-config";
const CONNECTION_DRAFT_KEY = "@desk-escape/connection-draft";
const RECENT_HOSTS_KEY = "@desk-escape/recent-hosts";
const PASSWORD_KEY_PREFIX = "@desk-escape/password:";
const SESSION_KEY_PREFIX = "@desk-escape/session:";
const DIRECTORY_KEY_PREFIX = "@desk-escape/directory:";

interface ConnectionContextValue {
  client: OpencodeClient | null;
  config: ConnectionConfig | null;
  cursorConfig: CursorConnectionConfig | null;
  providerType: AgentProviderType | null;
  provider: AgentProvider | null;
  status: ConnectionStatus;
  session: Session | null;
  sessionId: string | null;
  project: Project | null;
  activeDirectory: string | null;
  agentActive: boolean;
  contextAttachments: ContextAttachment[];
  recentHosts: StoredConnectionConfig[];
  errorMessage: string | null;
  authHeader: string | null;
  basicAuthCredential: BasicAuthCredential | null;
  reconnectAttempt: number;
  queuedMessages: QueuedMessage[];
  eventBus: EventBus;
  setAgentActive: (active: boolean) => void;
  connect: (config: AnyConnectionConfig, password?: string) => Promise<void>;
  disconnect: () => Promise<void>;
  reconnect: () => void;
  selectSession: (sessionId: string) => Promise<void>;
  selectProject: (worktree: string) => Promise<void>;
  createSession: (title?: string) => Promise<Session>;
  deleteSession: (sessionId: string) => Promise<void>;
  testServerConnection: (
    config: AnyConnectionConfig,
    password?: string,
  ) => Promise<{ healthy: boolean; version?: string }>;
  addContextAttachment: (path: string) => void;
  removeContextAttachment: (id: string) => void;
  clearContextAttachments: () => void;
  enqueueMessage: (
    text: string,
    attachments: QueuedMessage["attachments"],
  ) => Promise<void>;
  clearQueuedMessages: () => Promise<void>;
}

const ConnectionContext = createContext<ConnectionContextValue | undefined>(
  undefined,
);

async function loadPassword(baseUrl: string): Promise<string | undefined> {
  try {
    return (
      (await SecureStore.getItemAsync(`${PASSWORD_KEY_PREFIX}${baseUrl}`)) ??
      undefined
    );
  } catch {
    return undefined;
  }
}

async function savePassword(baseUrl: string, password: string): Promise<void> {
  await SecureStore.setItemAsync(`${PASSWORD_KEY_PREFIX}${baseUrl}`, password);
}

async function saveLastSessionId(
  baseUrl: string,
  sessionId: string,
): Promise<void> {
  await AsyncStorage.setItem(`${SESSION_KEY_PREFIX}${baseUrl}`, sessionId);
}

async function loadLastSessionId(baseUrl: string): Promise<string | undefined> {
  const value = await AsyncStorage.getItem(`${SESSION_KEY_PREFIX}${baseUrl}`);
  return value ?? undefined;
}

async function saveLastDirectory(
  baseUrl: string,
  directory: string,
): Promise<void> {
  await AsyncStorage.setItem(`${DIRECTORY_KEY_PREFIX}${baseUrl}`, directory);
}

async function loadLastDirectory(baseUrl: string): Promise<string | undefined> {
  const value = await AsyncStorage.getItem(`${DIRECTORY_KEY_PREFIX}${baseUrl}`);
  return value ?? undefined;
}

async function deletePassword(baseUrl: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(`${PASSWORD_KEY_PREFIX}${baseUrl}`);
  } catch {
    // Ignore missing secure entries.
  }
}

export async function loadConnectionDraft(): Promise<ConnectionDraft | null> {
  const stored = await AsyncStorage.getItem(CONNECTION_DRAFT_KEY);
  if (!stored) {
    return null;
  }

  try {
    return JSON.parse(stored) as ConnectionDraft;
  } catch {
    return null;
  }
}

export async function saveConnectionDraft(
  draft: ConnectionDraft,
): Promise<void> {
  await AsyncStorage.setItem(CONNECTION_DRAFT_KEY, JSON.stringify(draft));
}

export async function loadStoredConnectionConfig(): Promise<StoredConnectionConfig | null> {
  const stored = await AsyncStorage.getItem(CONFIG_STORAGE_KEY);
  if (!stored) {
    return null;
  }

  try {
    return JSON.parse(stored) as StoredConnectionConfig;
  } catch {
    return null;
  }
}

async function sendPromptDirectly(
  client: OpencodeClient,
  sessionId: string,
  directory: string | null,
  text: string,
  attachments: { path: string; name: string }[],
): Promise<void> {
  const attachmentParts = attachments.map((a) => ({
    type: "text" as const,
    text: `Context attachment: ${a.path}`,
  }));

  await client.session.prompt({
    path: { id: sessionId },
    ...(directory ? { query: { directory } } : {}),
    body: {
      parts: [...attachmentParts, { type: "text", text }],
    },
  });
}

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [client, setClient] = useState<OpencodeClient | null>(null);
  const [config, setConfig] = useState<ConnectionConfig | null>(null);
  const [cursorConfig, setCursorConfig] =
    useState<CursorConnectionConfig | null>(null);
  const [providerType, setProviderType] = useState<AgentProviderType | null>(
    null,
  );
  const [provider, setProvider] = useState<AgentProvider | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [session, setSession] = useState<Session | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [activeDirectory, setActiveDirectory] = useState<string | null>(null);
  const [agentActive, setAgentActive] = useState(false);
  const [contextAttachments, setContextAttachments] = useState<
    ContextAttachment[]
  >([]);
  const [recentHosts, setRecentHosts] = useState<StoredConnectionConfig[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [authHeader, setAuthHeader] = useState<string | null>(null);
  const [basicAuthCredential, setBasicAuthCredential] =
    useState<BasicAuthCredential | null>(null);
  const [savedPassword, setSavedPassword] = useState<string | undefined>(
    undefined,
  );
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const eventBus = useMemo(() => new EventBus(), []);
  const openCodeProvider = useMemo(() => new OpenCodeProvider(), []);
  const cursorProvider = useMemo(() => new CursorProvider(), []);

  const sendMessageDirectly = useCallback(
    async (text: string, attachments: QueuedMessage["attachments"]) => {
      if (!client || !session?.id) throw new Error("No active session.");
      await sendPromptDirectly(
        client,
        session.id,
        activeDirectory,
        text,
        attachments,
      );
    },
    [client, session, activeDirectory],
  );

  const { queue, enqueue, clearQueue, flushQueue } = useOfflineQueue({
    onSend: sendMessageDirectly,
  });

  const persistConfig = useCallback(async (next: StoredConnectionConfig) => {
    const stored = await AsyncStorage.getItem(RECENT_HOSTS_KEY);
    const existing: StoredConnectionConfig[] = stored
      ? (JSON.parse(stored) as StoredConnectionConfig[])
      : [];

    const filtered = existing.filter((item) => item.baseUrl !== next.baseUrl);
    const updated = [next, ...filtered].slice(0, 5);

    await AsyncStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(next));
    await AsyncStorage.setItem(RECENT_HOSTS_KEY, JSON.stringify(updated));
    setRecentHosts(updated);
  }, []);

  const connect = useCallback(
    async (nextConfig: AnyConnectionConfig, password?: string) => {
      setStatus("connecting");
      setErrorMessage(null);
      setSavedPassword(password);

      try {
        if (nextConfig.type === "cursor") {
          await cursorProvider.connect(nextConfig, password);
          setProviderType("cursor");
          setProvider(cursorProvider);
          setCursorConfig(nextConfig as CursorConnectionConfig);
          setStatus("connected");
          setAuthHeader(null);
          setBasicAuthCredential(null);
          await AsyncStorage.setItem(
            CONFIG_STORAGE_KEY,
            JSON.stringify({
              ...nextConfig,
              label: "Cursor Cloud Agents",
              lastConnectedAt: new Date().toISOString(),
            }),
          );
          return;
        }

        if (nextConfig.useAuth && password) {
          await savePassword(nextConfig.baseUrl, password);
        }

        if (!nextConfig.useAuth) {
          await deletePassword(nextConfig.baseUrl);
        }

        const nextClient = createAuthenticatedClient(
          nextConfig,
          nextConfig.useAuth ? password : undefined,
        );

        const health = await testConnection(
          nextConfig,
          nextConfig.useAuth ? password : undefined,
        );

        if (!health.healthy) {
          throw new Error("OpenCode server did not respond healthy.");
        }

        const initialProject = await fetchCurrentProject(nextClient);
        const savedDirectory =
          (await loadLastDirectory(nextConfig.baseUrl)) ??
          initialProject?.worktree ??
          null;

        const savedSessionId = await loadLastSessionId(nextConfig.baseUrl);
        const nextSession = await ensureSession(
          nextClient,
          savedSessionId,
          savedDirectory,
        );
        const nextProject = await fetchCurrentProject(
          nextClient,
          savedDirectory,
        );

        await openCodeProvider.connect(nextConfig, password);

        setClient(nextClient);
        setConfig(nextConfig);
        setSession(nextSession);
        setProject(nextProject);
        setActiveDirectory(savedDirectory);
        setProviderType("opencode");
        setProvider(openCodeProvider);
        setStatus("connected");
        void eventBus.start(nextClient);
        setAuthHeader(
          nextConfig.useAuth && password
            ? createAuthHeader(nextConfig.username, password)
            : null,
        );
        setBasicAuthCredential(
          nextConfig.useAuth && password
            ? { username: nextConfig.username, password }
            : null,
        );

        await saveLastSessionId(nextConfig.baseUrl, nextSession.id);
        if (savedDirectory) {
          await saveLastDirectory(nextConfig.baseUrl, savedDirectory);
        }

        await persistConfig({
          ...nextConfig,
          label: nextConfig.host,
          lastConnectedAt: new Date().toISOString(),
        });
      } catch (error) {
        if (nextConfig.type !== "cursor" && config) {
          clearClientCache(config);
        }
        setClient(null);
        setConfig(null);
        setSession(null);
        setProject(null);
        setActiveDirectory(null);
        setProviderType(null);
        setProvider(null);
        setStatus("error");
        setErrorMessage(
          error instanceof Error ? error.message : "Connection failed.",
        );
        throw error;
      }
    },
    [eventBus, persistConfig, cursorProvider, openCodeProvider],
  );

  const disconnect = useCallback(async () => {
    if (provider) {
      await provider.disconnect();
    } else {
      eventBus.stop();
    }
    setClient(null);
    setConfig(null);
    setCursorConfig(null);
    setSession(null);
    setProject(null);
    setActiveDirectory(null);
    setProviderType(null);
    setProvider(null);
    setAgentActive(false);
    setContextAttachments([]);
    setStatus("disconnected");
    setErrorMessage(null);
    setAuthHeader(null);
    setBasicAuthCredential(null);
  }, [provider, eventBus]);

  const selectSession = useCallback(
    async (sessionId: string) => {
      if (!provider) {
        throw new Error("Not connected.");
      }

      const session = await provider.selectSession(sessionId);
      setSession({
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        status: session.status,
      } as unknown as Session);
      await saveLastSessionId(config?.baseUrl ?? "", sessionId);
    },
    [provider, config],
  );

  const selectProject = useCallback(
    async (worktree: string) => {
      if (!provider || !config) {
        throw new Error("Not connected.");
      }

      setActiveDirectory(worktree);
      await saveLastDirectory(config.baseUrl, worktree);

      const nextProject =
        (await provider.getCurrentProject()) as Project | null;
      setProject(nextProject);

      const sessions = await provider.listSessions();
      const existing = sessions[0];

      if (existing) {
        setSession({
          id: existing.id,
          title: existing.title,
          createdAt: existing.createdAt,
          updatedAt: existing.updatedAt,
          status: existing.status,
        } as unknown as Session);
        await saveLastSessionId(config.baseUrl, existing.id);
      } else {
        const created = await provider.createSession("Desk Escape");
        setSession({
          id: created.id,
          title: created.title,
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
          status: created.status,
        } as unknown as Session);
        await saveLastSessionId(config.baseUrl, created.id);
      }

      setContextAttachments([]);
      await queryClient.invalidateQueries();
    },
    [client, config, provider, queryClient],
  );

  const createSession = useCallback(
    async (title?: string) => {
      if (!provider) {
        throw new Error("Not connected.");
      }

      const session = await provider.createSession(title);
      setSession({
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        status: session.status,
      } as unknown as Session);
      await saveLastSessionId(config?.baseUrl ?? "", session.id);
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      return session as unknown as Session;
    },
    [config, provider, queryClient],
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      if (!provider) {
        throw new Error("Not connected.");
      }

      await provider.deleteSession(sessionId);

      if (session?.id === sessionId) {
        const remaining = await provider.listSessions();
        const next = remaining[0];
        if (next) {
          setSession({
            id: next.id,
            title: next.title,
            createdAt: next.createdAt,
            updatedAt: next.updatedAt,
            status: next.status,
          } as unknown as Session);
          await saveLastSessionId(config?.baseUrl ?? "", next.id);
        } else {
          const created = await createSession();
          setSession(created);
        }
      }

      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    [config, provider, queryClient, session?.id, createSession],
  );

  const testServerConnection = useCallback(
    async (
      nextConfig: AnyConnectionConfig,
      password?: string,
    ): Promise<{ healthy: boolean; version?: string }> => {
      if (nextConfig.type === "cursor") {
        const result = await cursorProvider.testConnection(
          nextConfig,
          password,
        );
        return result;
      }
      return testConnection(
        nextConfig,
        nextConfig.useAuth ? password : undefined,
      );
    },
    [cursorProvider],
  );

  const handleReconnecting = useCallback(() => {
    setStatus("reconnecting");
  }, []);

  const handleReconnected = useCallback(() => {
    setStatus("connected");
    setReconnectAttempt(0);
    setErrorMessage(null);
  }, []);

  const handleReconnectFailed = useCallback((error: string) => {
    setStatus("error");
    setErrorMessage(error);
    setReconnectAttempt(0);
  }, []);

  useReconnect({
    config,
    password: savedPassword,
    status,
    onReconnecting: handleReconnecting,
    onConnected: handleReconnected,
    onFailed: handleReconnectFailed,
  });

  useEffect(() => {
    if (status === "connected" && queue.length > 0) {
      void flushQueue();
    }
  }, [status, queue.length, flushQueue]);

  const reconnect = useCallback(() => {
    if (!config) return;
    setStatus("error");
    setErrorMessage(null);
  }, [config]);

  const addContextAttachment = useCallback((path: string) => {
    setContextAttachments((current) => {
      if (current.some((item) => item.path === path)) {
        return current;
      }

      return [
        ...current,
        {
          id: `${path}-${Date.now()}`,
          path,
          addedAt: new Date().toISOString(),
        },
      ];
    });
  }, []);

  const removeContextAttachment = useCallback((id: string) => {
    setContextAttachments((current) =>
      current.filter((item) => item.id !== id),
    );
  }, []);

  const clearContextAttachments = useCallback(() => {
    setContextAttachments([]);
  }, []);

  useEffect(() => {
    void (async () => {
      const [storedConfig, storedHosts] = await Promise.all([
        AsyncStorage.getItem(CONFIG_STORAGE_KEY),
        AsyncStorage.getItem(RECENT_HOSTS_KEY),
      ]);

      if (storedHosts) {
        setRecentHosts(JSON.parse(storedHosts) as StoredConnectionConfig[]);
      }

      if (!storedConfig) {
        return;
      }

      const parsed = JSON.parse(storedConfig) as StoredConnectionConfig;
      const password = parsed.useAuth
        ? await loadPassword(parsed.baseUrl)
        : undefined;

      try {
        await connect(parsed as AnyConnectionConfig, password);
      } catch {
        setStatus("disconnected");
      }
    })();
  }, [connect]);

  useEffect(() => {
    return () => {
      eventBus.stop();
    };
  }, [eventBus]);

  const value = useMemo(
    () => ({
      client,
      config,
      cursorConfig,
      providerType,
      provider,
      status,
      session,
      sessionId: session?.id ?? null,
      project,
      activeDirectory,
      agentActive,
      contextAttachments,
      recentHosts,
      errorMessage,
      authHeader,
      basicAuthCredential,
      reconnectAttempt,
      queuedMessages: queue,
      eventBus,
      setAgentActive,
      connect,
      disconnect,
      reconnect,
      selectSession,
      selectProject,
      createSession,
      deleteSession,
      testServerConnection,
      addContextAttachment,
      removeContextAttachment,
      clearContextAttachments,
      enqueueMessage: enqueue,
      clearQueuedMessages: clearQueue,
    }),
    [
      agentActive,
      authHeader,
      basicAuthCredential,
      client,
      config,
      connect,
      contextAttachments,
      createSession,
      cursorConfig,
      cursorProvider,
      deleteSession,
      disconnect,
      enqueue,
      clearQueue,
      errorMessage,
      openCodeProvider,
      provider,
      providerType,
      project,
      queue,
      recentHosts,
      reconnect,
      reconnectAttempt,
      selectProject,
      selectSession,
      setAgentActive,
      status,
      session,
      testServerConnection,
      activeDirectory,
      addContextAttachment,
      removeContextAttachment,
      clearContextAttachments,
      eventBus,
    ],
  );

  return (
    <ConnectionContext.Provider value={value}>
      {children}
    </ConnectionContext.Provider>
  );
}

export function useConnection(): ConnectionContextValue {
  const context = useContext(ConnectionContext);
  if (!context) {
    throw new Error("useConnection must be used within ConnectionProvider.");
  }
  return context;
}

export async function readStoredPassword(
  baseUrl: string,
): Promise<string | undefined> {
  return loadPassword(baseUrl);
}
