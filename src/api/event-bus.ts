import type { OpenCodeClient, V2Event } from "@opencode/client";

/**
 * V2 renamed the subscription payload: `client.event.subscribe({ signal })` is
 * itself the `AsyncIterable` (V1 returned `{ stream }` behind a promise), and
 * the element type is the whole V2 event union rather than the single
 * `EventSubscribeResponse` record.
 */
type EventCallback = (event: V2Event) => void;

/** First reconnect delay; doubles per consecutive failure. */
const INITIAL_BACKOFF_MS = 1_000;
/** Upper bound on the reconnect delay so a long outage still recovers promptly. */
const MAX_BACKOFF_MS = 30_000;

interface PendingRetry {
  timer: ReturnType<typeof setTimeout>;
  resolve: () => void;
}

export class EventBus {
  private abortController: AbortController | null = null;
  private listeners: Set<EventCallback> = new Set();
  private running = false;
  /** Set by `stop()` to suppress further reconnects. */
  private stopped = true;
  private attempt = 0;
  private pendingRetry: PendingRetry | null = null;

  onEvent(callback: EventCallback): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  offEvent(callback: EventCallback): void {
    this.listeners.delete(callback);
  }

  /**
   * Connects and keeps the connection alive.
   *
   * V2 shares one transport per client, so a dropped SSE stream used to leave
   * the app permanently deaf to server events. The returned promise therefore
   * only settles once `stop()` is called or a retry is exhausted; callers are
   * expected to fire and forget it.
   */
  async start(client: OpenCodeClient): Promise<void> {
    if (this.running) {
      return;
    }

    this.stopped = false;
    this.running = true;
    this.attempt = 0;

    await this.connectLoop(client);
  }

  stop(): void {
    // Flag first: the loop checks it before scheduling another attempt.
    this.stopped = true;
    this.running = false;
    this.attempt = 0;

    this.abortController?.abort();
    this.abortController = null;

    this.cancelPendingRetry();
  }

  get isRunning(): boolean {
    return this.running;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async connectLoop(client: OpenCodeClient): Promise<void> {
    while (!this.stopped) {
      const connected = await this.consume(client);

      if (this.stopped || connected) {
        // Either we were asked to stop, or the stream ended and the transport
        // is being restarted elsewhere (e.g. a re-authentication).
        break;
      }

      await this.waitBeforeRetry();
    }

    this.running = false;
  }

  /**
   * Reads one stream to completion.
   *
   * @returns `true` when the stream ended on its own and should not be retried.
   */
  private async consume(client: OpenCodeClient): Promise<boolean> {
    const controller = new AbortController();
    this.abortController = controller;

    try {
      const stream = client.event.subscribe({
        signal: controller.signal,
        onActivity: () => this.noteActivity(),
      });

      for await (const event of stream) {
        if (this.stopped) {
          return true;
        }
        this.emit(event);
      }

      // Reaching here without an intentional stop means the remote host ended
      // the stream; the caller should reconnect with backoff.
      return this.stopped;
    } catch {
      // SSE is unavailable on some remote hosts, and transports throw on abort.
      return this.stopped;
    } finally {
      if (this.abortController === controller) {
        this.abortController = null;
      }
    }
  }

  private emit(event: V2Event): void {
    // Snapshot: a listener may unsubscribe (or subscribe) during dispatch.
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // One misbehaving listener must not take down the event stream.
      }
    }
  }

  /**
   * A keepalive frame means the transport is healthy, so the reconnect backoff
   * is reset. Without this a server that accepts a connection and then stalls
   * would keep escalating the delay forever.
   */
  private noteActivity(): void {
    if (!this.stopped) {
      this.attempt = 0;
    }
  }

  private async waitBeforeRetry(): Promise<void> {
    if (this.stopped) {
      return;
    }

    const delay = Math.min(
      INITIAL_BACKOFF_MS * 2 ** this.attempt,
      MAX_BACKOFF_MS,
    );
    this.attempt += 1;

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingRetry?.timer === timer) {
          this.pendingRetry = null;
        }
        resolve();
      }, delay);

      this.pendingRetry = { timer, resolve };
    });
  }

  private cancelPendingRetry(): void {
    const pending = this.pendingRetry;
    if (!pending) {
      return;
    }
    this.pendingRetry = null;
    clearTimeout(pending.timer);
    pending.resolve();
  }
}
