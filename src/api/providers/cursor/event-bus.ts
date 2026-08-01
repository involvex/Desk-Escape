import type { CursorApiClient } from "./client";
import type { CursorStreamEvent } from "./types";

type EventCallback = (event: unknown) => void;

export class CursorEventBus {
  private abortController: AbortController | null = null;
  private listeners: Set<EventCallback> = new Set();
  private active = false;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  onEvent(callback: EventCallback): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  async start(
    client: CursorApiClient,
    agentId: string,
    runId: string,
  ): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.abortController = new AbortController();

    try {
      const stream = await client.streamRun(
        agentId,
        runId,
        this.abortController.signal,
      );
      this.reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (this.active) {
        const { done, value } = await this.reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === "[DONE]") continue;

          try {
            const event = JSON.parse(jsonStr) as CursorStreamEvent;
            for (const listener of this.listeners) {
              listener(event);
            }
          } catch {
            // skip malformed events
          }
        }
      }
    } catch {
      // stream may fail on network issues
    } finally {
      this.active = false;
      this.reader = null;
    }
  }

  stop(): void {
    this.active = false;
    this.abortController?.abort();
    this.abortController = null;
    this.reader?.cancel().catch(() => {});
    this.reader = null;
  }

  get isRunning(): boolean {
    return this.active;
  }
}
