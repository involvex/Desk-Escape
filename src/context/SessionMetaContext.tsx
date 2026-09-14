import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const PINNED_KEY = "@desk-escape/pinned-sessions";
const ARCHIVED_KEY = "@desk-escape/archived-sessions";
const TEMPLATES_KEY = "@desk-escape/session-templates";

export interface SessionTemplate {
  id: string;
  name: string;
  prompt: string;
  agent?: string;
  model?: { providerId: string; modelId: string };
}

interface SessionMetaContextValue {
  pinnedIds: string[];
  archivedIds: string[];
  templates: SessionTemplate[];
  ready: boolean;
  isPinned: (sessionId: string) => boolean;
  isArchived: (sessionId: string) => boolean;
  pinSession: (sessionId: string) => void;
  unpinSession: (sessionId: string) => void;
  togglePin: (sessionId: string) => void;
  archiveSession: (sessionId: string) => void;
  unarchiveSession: (sessionId: string) => void;
  toggleArchive: (sessionId: string) => void;
  addTemplate: (template: Omit<SessionTemplate, "id">) => Promise<void>;
  updateTemplate: (
    id: string,
    patch: Partial<Omit<SessionTemplate, "id">>,
  ) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
}

const SessionMetaContext = createContext<SessionMetaContextValue | undefined>(
  undefined,
);

async function readStringArray(key: string): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function SessionMetaProvider({ children }: { children: ReactNode }) {
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [archivedIds, setArchivedIds] = useState<string[]>([]);
  const [templates, setTemplates] = useState<SessionTemplate[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      const [pinned, archived, templatesRaw] = await Promise.all([
        readStringArray(PINNED_KEY),
        readStringArray(ARCHIVED_KEY),
        AsyncStorage.getItem(TEMPLATES_KEY),
      ]);
      setPinnedIds(pinned);
      setArchivedIds(archived);
      if (templatesRaw) {
        try {
          const parsed = JSON.parse(templatesRaw) as SessionTemplate[];
          if (Array.isArray(parsed)) {
            setTemplates(parsed);
          }
        } catch {
          // Keep empty.
        }
      }
      setReady(true);
    })();
  }, []);

  const persistPinned = useCallback((next: string[]) => {
    setPinnedIds(next);
    void AsyncStorage.setItem(PINNED_KEY, JSON.stringify(next));
  }, []);

  const persistArchived = useCallback((next: string[]) => {
    setArchivedIds(next);
    void AsyncStorage.setItem(ARCHIVED_KEY, JSON.stringify(next));
  }, []);

  const persistTemplates = useCallback((next: SessionTemplate[]) => {
    setTemplates(next);
    void AsyncStorage.setItem(TEMPLATES_KEY, JSON.stringify(next));
  }, []);

  const isPinned = useCallback(
    (sessionId: string) => pinnedIds.includes(sessionId),
    [pinnedIds],
  );

  const isArchived = useCallback(
    (sessionId: string) => archivedIds.includes(sessionId),
    [archivedIds],
  );

  const pinSession = useCallback(
    (sessionId: string) => {
      if (pinnedIds.includes(sessionId)) return;
      persistPinned([sessionId, ...pinnedIds]);
    },
    [persistPinned, pinnedIds],
  );

  const unpinSession = useCallback(
    (sessionId: string) => {
      persistPinned(pinnedIds.filter((id) => id !== sessionId));
    },
    [persistPinned, pinnedIds],
  );

  const togglePin = useCallback(
    (sessionId: string) => {
      if (pinnedIds.includes(sessionId)) {
        unpinSession(sessionId);
      } else {
        pinSession(sessionId);
      }
    },
    [pinSession, pinnedIds, unpinSession],
  );

  const archiveSession = useCallback(
    (sessionId: string) => {
      const nextArchived = archivedIds.includes(sessionId)
        ? archivedIds
        : [sessionId, ...archivedIds];
      persistArchived(nextArchived);
      // Archiving unpins to avoid hidden-but-pinned state.
      if (pinnedIds.includes(sessionId)) {
        persistPinned(pinnedIds.filter((id) => id !== sessionId));
      }
    },
    [archivedIds, persistArchived, persistPinned, pinnedIds],
  );

  const unarchiveSession = useCallback(
    (sessionId: string) => {
      persistArchived(archivedIds.filter((id) => id !== sessionId));
    },
    [archivedIds, persistArchived],
  );

  const toggleArchive = useCallback(
    (sessionId: string) => {
      if (archivedIds.includes(sessionId)) {
        unarchiveSession(sessionId);
      } else {
        archiveSession(sessionId);
      }
    },
    [archiveSession, archivedIds, unarchiveSession],
  );

  const addTemplate = useCallback(
    async (template: Omit<SessionTemplate, "id">) => {
      const id = `tmpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      persistTemplates([...templates, { ...template, id }]);
    },
    [persistTemplates, templates],
  );

  const updateTemplate = useCallback(
    async (id: string, patch: Partial<Omit<SessionTemplate, "id">>) => {
      persistTemplates(
        templates.map((item) =>
          item.id === id ? { ...item, ...patch } : item,
        ),
      );
    },
    [persistTemplates, templates],
  );

  const deleteTemplate = useCallback(
    async (id: string) => {
      persistTemplates(templates.filter((item) => item.id !== id));
    },
    [persistTemplates, templates],
  );

  const value = useMemo(
    () => ({
      pinnedIds,
      archivedIds,
      templates,
      ready,
      isPinned,
      isArchived,
      pinSession,
      unpinSession,
      togglePin,
      archiveSession,
      unarchiveSession,
      toggleArchive,
      addTemplate,
      updateTemplate,
      deleteTemplate,
    }),
    [
      addTemplate,
      archiveSession,
      archivedIds,
      deleteTemplate,
      isArchived,
      isPinned,
      pinSession,
      pinnedIds,
      ready,
      templates,
      toggleArchive,
      togglePin,
      unarchiveSession,
      unpinSession,
      updateTemplate,
    ],
  );

  return (
    <SessionMetaContext.Provider value={value}>
      {children}
    </SessionMetaContext.Provider>
  );
}

export function useSessionMeta(): SessionMetaContextValue {
  const context = useContext(SessionMetaContext);
  if (!context) {
    throw new Error("useSessionMeta must be used within SessionMetaProvider.");
  }
  return context;
}
