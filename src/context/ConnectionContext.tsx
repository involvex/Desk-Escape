import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import type { OpencodeClient, Project, Session } from "@opencode-ai/sdk/client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
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
  StoredConnectionConfig,
} from "@/types/opencode";

const CONFIG_STORAGE_KEY = "@desk-escape/connection-config";
const RECENT_HOSTS_KEY = "@desk-escape/recent-hosts";
const PASSWORD_KEY_PREFIX = "@desk-escape/password:";
const SESSION_KEY_PREFIX = "@desk-escape/session:";

interface ConnectionContextValue {
  client: OpencodeClient | null;
  config: ConnectionConfig | null;
  status: ConnectionStatus;
  session: Session | null;
  sessionId: string | null;
  project: Project | null;
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
  createSession: (title?: string) => Promise<Session>;
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

async function deletePassword(baseUrl: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(`${PASSWORD_KEY_PREFIX}${baseUrl}`);
  } catch {
    // Ignore missing secure entries.
  }
}

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<OpencodeClient | null>(null);
  const [config, setConfig] = useState<ConnectionConfig | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [session, setSession] = useState<Session | null>(null);
  const [project, setProject] = useState<Project | null>(null);
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

        const savedSessionId = await loadLastSessionId(nextConfig.baseUrl);
        const nextSession = await ensureSession(nextClient, savedSessionId);
        const nextProject = await fetchCurrentProject(nextClient);

        setClient(nextClient);
        setConfig(nextConfig);
        setSession(nextSession);
        setProject(nextProject);
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
      });

      if (!result.data) {
        throw new Error("Session not found.");
      }

      setSession(result.data);
      await saveLastSessionId(config.baseUrl, sessionId);
    },
    [client, config],
  );

  const createSession = useCallback(
    async (title?: string) => {
      if (!client || !config) {
        throw new Error("Not connected.");
      }

      const created = await client.session.create({
        body: { title: title ?? "Desk Escape" },
      });

      if (!created.data) {
        throw new Error("Failed to create session.");
      }

      setSession(created.data);
      await saveLastSessionId(config.baseUrl, created.data.id);
      return created.data;
    },
    [client, config],
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
      createSession,
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
      agentActive,
      contextAttachments,
      recentHosts,
      errorMessage,
      authHeader,
      basicAuthCredential,
      connect,
      disconnect,
      selectSession,
      createSession,
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
