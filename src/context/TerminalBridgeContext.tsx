import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useConnection } from "@/context/ConnectionContext";
import {
  drainWrites,
  emptyWriteQueue,
  enqueueWrite,
  toTerminalInput,
  type WriteQueue,
} from "@/utils/terminal-input";

/**
 * Carries a write from the chat to the shell.
 *
 * Returns whether it was delivered, so a caller can tell a write that reached the
 * socket from one that did not rather than assuming success.
 */
export type TerminalWriteSink = (text: string) => boolean;

/** A batch of writes that reached a shell. */
export interface TerminalDelivery {
  count: number;
  /**
   * Bumped on every delivery, so two batches of the same size still refresh the
   * confirmation's timer instead of looking like the same event twice.
   */
  token: number;
}

interface TerminalBridgeContextValue {
  /**
   * Write text to the shell, starting it if it is not already up.
   *
   * The panel unmounts on every tab switch, so at the moment "Run" is tapped there
   * is usually no shell and no socket. The text is therefore queued first and
   * delivered now only if a live sink accepts it; `TerminalPanel` drains whatever
   * is left when its socket opens.
   */
  runInTerminal: (text: string) => void;
  /**
   * Register the live sink, or pass `null` when the shell goes away.
   *
   * A ref rather than state: the sink changes identity when the socket
   * reconnects, and re-rendering every consumer on each reconnect would put the
   * chat's `useCallback` chain in a loop for no benefit.
   */
  setWriteSink: (sink: TerminalWriteSink | null) => void;
  /**
   * Deliver everything queued for a directory and drop it. Returns how many were
   * written, so the caller can tell the user when a command ran.
   */
  drainFor: (directory: string | null) => number;
  /** The most recent delivery, so the shell can confirm it. */
  lastDelivery: TerminalDelivery | null;
  clearDelivery: () => void;
  /** Writes waiting for a socket. For tests and diagnostics. */
  pendingCount: number;
}

const TerminalBridgeContext = createContext<
  TerminalBridgeContextValue | undefined
>(undefined);

/**
 * Queued writes are not dropped when the panel unmounts.
 *
 * A write is a request to run a command in a project, tagged with the directory
 * it was asked for, so it cannot fire somewhere the user did not intend. Making
 * it survive a tab switch is the difference between "I asked for this and it ran
 * when the shell was ready" and "I tapped Run and nothing happened". An earlier
 * `cancelPending` cleared the queue on unmount, which also wiped writes the user
 * had not seen run yet — so it was removed rather than kept as an unused footgun.
 */
export function TerminalBridgeProvider({ children }: { children: ReactNode }) {
  const { activeDirectory } = useConnection();
  const [queue, setQueue] = useState<WriteQueue>(emptyWriteQueue);
  const [lastDelivery, setLastDelivery] = useState<TerminalDelivery | null>(
    null,
  );
  const sinkRef = useRef<TerminalWriteSink | null>(null);

  const setWriteSink = useCallback((sink: TerminalWriteSink | null) => {
    sinkRef.current = sink;
  }, []);

  const runInTerminal = useCallback(
    (text: string) => {
      const typed = toTerminalInput(text, { newline: false });
      if (typed === "") {
        return;
      }

      const sink = sinkRef.current;
      if (sink && sink(typed)) {
        // Delivered live, so it is typed rather than submitted: the shell is
        // sitting at a prompt and Enter is the user's to press. Framing with a
        // newline here would run the command immediately and leave a blank
        // prompt line, and pressing Enter on that line would re-run it.
        return;
      }

      // No live shell, or the socket refused it. Queued for the next connect and
      // submitted then, because nobody will be there to press Enter.
      //
      // Delivered *or* queued, never both — the alternative (queue first, then
      // remove on success) puts the sink call inside a state updater, and a
      // double-invoked updater would type the command twice.
      setQueue((current) => enqueueWrite(current, text, activeDirectory));
    },
    [activeDirectory],
  );

  /**
   * Reads `queue` from closure and commits by value, so two overlapping calls
   * would each write a queue derived from the same snapshot. That cannot happen
   * here: the only caller is the connect effect, effects run serially, and React
   * re-renders between them. Keeping the sink call outside every state updater
   * matters more — an updater may be invoked twice, and sending text twice would
   * type the command twice.
   */
  const drainFor = useCallback(
    (directory: string | null) => {
      const sink = sinkRef.current;
      // Checked before anything is taken. A drain with nowhere to send would
      // otherwise remove the writes and report success, losing a command the user
      // was told had run.
      if (!sink) {
        return 0;
      }

      const result = drainWrites(queue, directory);
      if (result.writes.length === 0) {
        return 0;
      }
      // Dropped as it is taken, so a reconnect cannot replay a delivered write.
      setQueue(result.queue);

      // Queued writes arrive at a freshly spawned shell, so they are submitted:
      // nobody is there to press Enter. A sink that rejects one re-queues the
      // rest rather than losing them.
      let delivered = 0;
      const undelivered: typeof result.writes = [];
      for (const write of result.writes) {
        if (sink(write.text)) {
          delivered += 1;
        } else {
          undelivered.push(write);
        }
      }
      if (undelivered.length > 0) {
        setQueue((current) => ({
          nextId: current.nextId,
          pending: [
            ...undelivered,
            ...current.pending.filter(
              (write) => !undelivered.some((left) => left.id === write.id),
            ),
          ],
        }));
      }
      if (delivered > 0) {
        // Lives here rather than in the caller because the caller is an effect,
        // and setting confirmation state from an effect body is a second render
        // pass for something the shell is about to display anyway.
        setLastDelivery((current) => ({
          count: delivered,
          token: (current?.token ?? 0) + 1,
        }));
      }
      return delivered;
    },
    [queue],
  );

  const clearDelivery = useCallback(() => {
    setLastDelivery(null);
  }, []);

  const value = useMemo<TerminalBridgeContextValue>(
    () => ({
      runInTerminal,
      setWriteSink,
      drainFor,
      lastDelivery,
      clearDelivery,
      pendingCount: queue.pending.length,
    }),
    [
      clearDelivery,
      drainFor,
      lastDelivery,
      queue.pending.length,
      runInTerminal,
      setWriteSink,
    ],
  );

  return (
    <TerminalBridgeContext.Provider value={value}>
      {children}
    </TerminalBridgeContext.Provider>
  );
}

export function useTerminalBridge(): TerminalBridgeContextValue {
  const context = useContext(TerminalBridgeContext);
  if (!context) {
    throw new Error(
      "useTerminalBridge must be used inside a TerminalBridgeProvider",
    );
  }
  return context;
}
