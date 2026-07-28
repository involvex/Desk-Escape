import type { OpencodeClient } from "@opencode-ai/sdk/client";

type EventCallback = (event: unknown) => void;

export class EventBus {
  private abortController: AbortController | null = null;
  private listeners: Set<EventCallback> = new Set();
  private active = false;

  onEvent(callback: EventCallback): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  offEvent(callback: EventCallback): void {
    this.listeners.delete(callback);
  }

  async start(client: OpencodeClient): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.abortController = new AbortController();

    try {
      const subscription = await client.event.subscribe({
        signal: this.abortController.signal,
      });

      for await (const event of subscription.stream) {
        if (!this.active) break;
        for (const listener of this.listeners) {
          listener(event);
        }
      }
    } catch {
      // SSE may be unavailable on some remote hosts
    } finally {
      this.active = false;
    }
  }

  stop(): void {
    this.active = false;
    this.abortController?.abort();
    this.abortController = null;
  }

  get isRunning(): boolean {
    return this.active;
  }
}
