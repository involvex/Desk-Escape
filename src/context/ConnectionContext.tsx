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
import { withDirectoryQuery } from "@/api/directory";
import {
  clearClientCache,
  createAuthenticatedClient,
  createAuthHeader,
  ensureSession,
  fetchCurrentProject,
  testConnection,
} from "@/api/client";
import type {
  ConnectionConfig,
  ConnectionStatus,
  ContextAttachment,
  BasicAuthCredential,
  ConnectionDraft,
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
  setAgentActive: (active: boolean) => void;
  connect: (config: ConnectionConfig, password?: string) => Promise<void>;
  disconnect: () => Promise<void>;
  selectSession: (sessionId: string) => Promise<void>;
  selectProject: (worktree: string) => Promise<void>;
  createSession: (title?: string) => Promise<Session>;
  deleteSession: (sessionId: string) => Promise<void>;
  testServerConnection: (
    config: ConnectionConfig,
    password?: string,
  ) => Promise<{ healthy: boolean; version?: string }>;
  addContextAttachment: (path: string) => void;
  removeContextAttachment: (id: string) => void;
  clearContextAttachments: () => void;
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

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [client, setClient] = useState<OpencodeClient | null>(null);
  const [config, setConfig] = useState<ConnectionConfig | null>(null);
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
    async (nextConfig: ConnectionConfig, password?: string) => {
      setStatus("connecting");
      setErrorMessage(null);

      try {
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

        setClient(nextClient);
        setConfig(nextConfig);
        setSession(nextSession);
        setProject(nextProject);
        setActiveDirectory(savedDirectory);
        setStatus("connected");
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
        clearClientCache(nextConfig);
        setClient(null);
        setConfig(null);
        setSession(null);
        setProject(null);
        setActiveDirectory(null);
        setStatus("error");
        setErrorMessage(
          error instanceof Error ? error.message : "Connection failed.",
        );
        throw error;
      }
    },
    [persistConfig],
  );

  const disconnect = useCallback(async () => {
    if (config) {
      clearClientCache(config);
    }
    setClient(null);
    setConfig(null);
    setSession(null);
    setProject(null);
    setActiveDirectory(null);
    setAgentActive(false);
    setContextAttachments([]);
    setStatus("disconnected");
    setErrorMessage(null);
    setAuthHeader(null);
    setBasicAuthCredential(null);
  }, [config]);

  const selectSession = useCallback(
    async (sessionId: string) => {
      if (!client || !config) {
        throw new Error("Not connected.");
      }

      const result = await client.session.get({
        path: { id: sessionId },
        ...withDirectoryQuery(activeDirectory),
      });

      if (!result.data) {
        throw new Error("Session not found.");
      }

      setSession(result.data);
      await saveLastSessionId(config.baseUrl, sessionId);
    },
    [activeDirectory, client, config],
  );

  const selectProject = useCallback(
    async (worktree: string) => {
      if (!client || !config) {
        throw new Error("Not connected.");
      }

      setActiveDirectory(worktree);
      await saveLastDirectory(config.baseUrl, worktree);

      const nextProject = await fetchCurrentProject(client, worktree);
      setProject(nextProject);

      const sessions = await client.session.list(withDirectoryQuery(worktree));
      const existing = sessions.data?.[0];

      if (existing) {
        setSession(existing);
        await saveLastSessionId(config.baseUrl, existing.id);
      } else {
        const created = await client.session.create({
          ...withDirectoryQuery(worktree),
          body: { title: "Desk Escape" },
        });
        if (!created.data) {
          throw new Error("Failed to create session for project.");
        }
        setSession(created.data);
        await saveLastSessionId(config.baseUrl, created.data.id);
      }

      setContextAttachments([]);
      await queryClient.invalidateQueries();
    },
    [client, config, queryClient],
  );

  const createSession = useCallback(
    async (title?: string) => {
      if (!client || !config) {
        throw new Error("Not connected.");
      }

      const created = await client.session.create({
        ...withDirectoryQuery(activeDirectory),
        body: { title: title ?? "Desk Escape" },
      });

      if (!created.data) {
        throw new Error("Failed to create session.");
      }

      setSession(created.data);
      await saveLastSessionId(config.baseUrl, created.data.id);
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      return created.data;
    },
    [activeDirectory, client, config, queryClient],
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      if (!client || !config) {
        throw new Error("Not connected.");
      }

      await client.session.delete({
        path: { id: sessionId },
        ...withDirectoryQuery(activeDirectory),
      });

      if (session?.id === sessionId) {
        const remaining = await client.session.list(
          withDirectoryQuery(activeDirectory),
        );
        const next = remaining.data?.[0];
        if (next) {
          setSession(next);
          await saveLastSessionId(config.baseUrl, next.id);
        } else {
          const created = await createSession();
          setSession(created);
        }
      }

      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    [activeDirectory, client, config, createSession, queryClient, session?.id],
  );

  const testServerConnection = useCallback(
    async (nextConfig: ConnectionConfig, password?: string) => {
      return testConnection(
        nextConfig,
        nextConfig.useAuth ? password : undefined,
      );
    },
    [],
  );

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
        await connect(parsed, password);
      } catch {
        setStatus("disconnected");
      }
    })();
  }, [connect]);

  const value = useMemo(
    () => ({
      client,
      config,
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
      setAgentActive,
      connect,
      disconnect,
      selectSession,
      selectProject,
      createSession,
      deleteSession,
      testServerConnection,
      addContextAttachment,
      removeContextAttachment,
      clearContextAttachments,
    }),
    [
      client,
      config,
      status,
      session,
      project,
      activeDirectory,
      agentActive,
      contextAttachments,
      recentHosts,
      errorMessage,
      authHeader,
      basicAuthCredential,
      connect,
      disconnect,
      selectSession,
      selectProject,
      createSession,
      deleteSession,
      testServerConnection,
      addContextAttachment,
      removeContextAttachment,
      clearContextAttachments,
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
