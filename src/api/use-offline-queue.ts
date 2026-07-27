import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { QueuedMessage } from "@/types/opencode";

const STORAGE_KEY = "@desk-escape/offline-queue";

let nextId = 0;
function generateId(): string {
  nextId += 1;
  return `q-${Date.now()}-${nextId}`;
}

async function loadQueue(): Promise<QueuedMessage[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as QueuedMessage[]) : [];
  } catch {
    return [];
  }
}

async function saveQueue(queue: QueuedMessage[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

export interface UseOfflineQueueOptions {
  onSend: (
    text: string,
    attachments: QueuedMessage["attachments"],
  ) => Promise<void>;
}

export function useOfflineQueue({ onSend }: UseOfflineQueueOptions) {
  const [queue, setQueue] = useState<QueuedMessage[]>([]);

  useEffect(() => {
    void loadQueue().then(setQueue);
  }, []);

  const enqueue = useCallback(
    async (text: string, attachments: QueuedMessage["attachments"]) => {
      const entry: QueuedMessage = {
        id: generateId(),
        text,
        attachments,
        timestamp: Date.now(),
      };
      const next = [...queue, entry];
      setQueue(next);
      await saveQueue(next);
    },
    [queue],
  );

  const dequeue = useCallback(
    async (id: string) => {
      const next = queue.filter((m) => m.id !== id);
      setQueue(next);
      await saveQueue(next);
    },
    [queue],
  );

  const clearQueue = useCallback(async () => {
    setQueue([]);
    await AsyncStorage.removeItem(STORAGE_KEY);
  }, []);

  const flushQueue = useCallback(async () => {
    if (queue.length === 0) return;

    for (const message of queue) {
      try {
        await onSend(message.text, message.attachments);
      } catch {
        break;
      }
    }

    const remaining = await loadQueue();
    setQueue(remaining);
  }, [queue, onSend]);

  return { queue, enqueue, dequeue, clearQueue, flushQueue };
}
