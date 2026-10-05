import type { FormAnswer } from "@opencode/client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toOpenCodeError } from "@/api/opencode/errors";
import {
  cancelForm,
  FORM_POLL_INTERVAL_MS,
  listPendingForms,
  parseFormEvent,
  parseFormResolvedEvent,
  pollForms,
  replyToForm,
  type PendingForm,
} from "@/api/forms";
import { useConnection } from "@/context/ConnectionContext";

interface QuestionContextValue {
  pending: PendingForm | null;
  /** Submit `{ fieldKey: value }` answers. */
  reply: (answer: FormAnswer) => Promise<void>;
  /**
   * Decline the form.
   *
   * V2 has no form-reject endpoint; this maps to `session.form.cancel`, which
   * is the nearest available equivalent and does surface server-side (as a
   * `form.cancelled` event) rather than failing silently.
   */
  cancel: () => Promise<void>;
  /** Hide the banner locally without telling the server anything. */
  dismiss: () => void;
  /** `true` while a reply or cancel is in flight. */
  busy: boolean;
  /** Last failure message, or `null`. */
  error: string | null;
  clearError: () => void;
}

const QuestionContext = createContext<QuestionContextValue | undefined>(
  undefined,
);

export function QuestionProvider({ children }: { children: ReactNode }) {
  const {
    activeDirectory,
    eventBus,
    client: v2Client,
    status,
  } = useConnection();
  const [pending, setPending] = useState<PendingForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!v2Client || !eventBus) return;

    const unsubscribe = eventBus.onEvent((event) => {
      // `form.replied` and `form.cancelled` both take the form off the list.
      const resolved = parseFormResolvedEvent(event);
      if (resolved) {
        setPending((current) => (current?.id === resolved.id ? null : current));
        return;
      }
      const form = parseFormEvent(event);
      if (form) {
        setPending(form);
      }
    });

    return unsubscribe;
  }, [v2Client, eventBus]);

  // Rehydrate on mount / on location change so a form raised while the app was
  // backgrounded is still shown. A failure here is not worth surfacing: the
  // event stream still delivers anything raised from here on.
  useEffect(() => {
    if (!v2Client) return;

    let cancelled = false;
    void listPendingForms(v2Client, activeDirectory)
      .then((items) => {
        const first = items[0];
        if (cancelled || !first) return;
        setPending((current) => current ?? first);
      })
      .catch(() => {
        // Swallowed on purpose; see above.
      });

    return () => {
      cancelled = true;
    };
  }, [v2Client, activeDirectory]);

  // Backstop poll for events the WS could not deliver -- e.g. a form raised
  // while the app was backgrounded and the JS thread suspended. Gated on
  // `connected`: while reconnecting the cold-start read above is retriggered by
  // the `v2Client` dependency anyway. `pendingRef` snapshots the latest pending
  // so the interval never clobbers a form the user is answering; `selectPolledForm`
  // enforces that either way. See `@/api/forms` and `docs/ARCHITECTURE.md` §5.2.
  const pendingRef = useRef(pending);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  useEffect(() => {
    if (status !== "connected" || !v2Client) return;

    void pollForms(v2Client, activeDirectory, pendingRef.current).then(
      setPending,
    );
    const id = setInterval(
      () =>
        void pollForms(v2Client, activeDirectory, pendingRef.current).then(
          setPending,
        ),
      FORM_POLL_INTERVAL_MS,
    );

    return () => {
      clearInterval(id);
    };
  }, [v2Client, activeDirectory, status]);

  const reply = useCallback(
    async (answer: FormAnswer) => {
      if (!v2Client || !pending) {
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await replyToForm(v2Client, {
          sessionId: pending.sessionId,
          formId: pending.id,
          answer,
        });
        setPending(null);
      } catch (replyError) {
        setError(toOpenCodeError(replyError).message);
        throw replyError;
      } finally {
        setBusy(false);
      }
    },
    [pending, v2Client],
  );

  const cancel = useCallback(async () => {
    if (!v2Client || !pending) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await cancelForm(v2Client, {
        sessionId: pending.sessionId,
        formId: pending.id,
      });
      setPending(null);
    } catch (cancelError) {
      setError(toOpenCodeError(cancelError).message);
      throw cancelError;
    } finally {
      setBusy(false);
    }
  }, [pending, v2Client]);

  const dismiss = useCallback(() => {
    setPending(null);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const visiblePending = v2Client ? pending : null;

  const value = useMemo(
    () => ({
      pending: visiblePending,
      reply,
      cancel,
      dismiss,
      busy,
      error,
      clearError,
    }),
    [busy, cancel, clearError, dismiss, error, reply, visiblePending],
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
