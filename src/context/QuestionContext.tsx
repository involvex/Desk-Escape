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
  isQuestionResolvedEvent,
  listPendingQuestions,
  parseQuestionEvent,
  rejectQuestion,
  replyToQuestion,
  type PendingQuestion,
} from "@/api/questions";
import { useConnection } from "@/context/ConnectionContext";

interface QuestionContextValue {
  pending: PendingQuestion | null;
  reply: (answers: string[][]) => Promise<void>;
  reject: () => Promise<void>;
  dismiss: () => void;
}

const QuestionContext = createContext<QuestionContextValue | undefined>(
  undefined,
);

export function QuestionProvider({ children }: { children: ReactNode }) {
  const { config, authHeader, activeDirectory, eventBus, client } =
    useConnection();
  const [pending, setPending] = useState<PendingQuestion | null>(null);

  useEffect(() => {
    if (!client || !eventBus) return;

    const unsubscribe = eventBus.onEvent((event: unknown) => {
      const typed = event as {
        type: string;
        properties?: Record<string, unknown>;
      };
      const resolved = isQuestionResolvedEvent(typed);
      if (resolved) {
        setPending((current) => (current?.id === resolved.id ? null : current));
        return;
      }
      const question = parseQuestionEvent(typed);
      if (question) {
        setPending(question);
      }
    });

    return unsubscribe;
  }, [client, eventBus]);

  useEffect(() => {
    if (!config?.baseUrl || !client) {
      return;
    }

    let cancelled = false;
    void listPendingQuestions(config.baseUrl, authHeader, activeDirectory).then(
      (items) => {
        if (!cancelled && items[0]) {
          setPending(items[0]);
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [activeDirectory, authHeader, client, config]);

  const reply = useCallback(
    async (answers: string[][]) => {
      if (!config?.baseUrl || !pending) {
        return;
      }
      await replyToQuestion(
        config.baseUrl,
        authHeader,
        pending.id,
        answers,
        activeDirectory,
      );
      setPending(null);
    },
    [activeDirectory, authHeader, config, pending],
  );

  const reject = useCallback(async () => {
    if (!config?.baseUrl || !pending) {
      return;
    }
    await rejectQuestion(
      config.baseUrl,
      authHeader,
      pending.id,
      activeDirectory,
    );
    setPending(null);
  }, [activeDirectory, authHeader, config, pending]);

  const dismiss = useCallback(() => {
    setPending(null);
  }, []);

  const visiblePending = client && config?.baseUrl ? pending : null;

  const value = useMemo(
    () => ({
      pending: visiblePending,
      reply,
      reject,
      dismiss,
    }),
    [dismiss, reject, reply, visiblePending],
  );

  return (
    <QuestionContext.Provider value={value}>
      {children}
    </QuestionContext.Provider>
  );
}

export function useQuestion(): QuestionContextValue {
  const context = useContext(QuestionContext);
  if (!context) {
    throw new Error("useQuestion must be used within QuestionProvider.");
  }
  return context;
}
