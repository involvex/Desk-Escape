import { useCallback, useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { testConnection } from "@/api/client";
import type { ConnectionConfig, ConnectionStatus } from "@/types/opencode";

const HEALTH_PING_INTERVAL = 30_000;
const MAX_BACKOFF = 60_000;
const BASE_BACKOFF = 1_000;
const MAX_RECONNECT_ATTEMPTS = 20;

interface UseReconnectOptions {
  config: ConnectionConfig | null;
  password: string | undefined;
  status: ConnectionStatus;
  onReconnecting: () => void;
  onConnected: () => void;
  onFailed: (error: string) => void;
}

function getBackoff(attempt: number): number {
  const delay = Math.min(BASE_BACKOFF * 2 ** attempt, MAX_BACKOFF);
  const jitter = delay * 0.1 * Math.random();
  return Math.round(delay + jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function reconnectLoop(
  config: ConnectionConfig,
  password: string | undefined,
  signal: AbortSignal,
  onReconnecting: () => void,
  onConnected: () => void,
  onFailed: (error: string) => void,
): Promise<void> {
  for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt++) {
    if (signal.aborted) return;

    onReconnecting();

    try {
      const result = await testConnection(config, password);
      if (result.healthy) {
        onConnected();
        return;
      }
    } catch {
      // Connection failed, continue to backoff.
    }

    if (signal.aborted) return;

    const delay = getBackoff(attempt + 1);
    await Promise.race([
      sleep(delay),
      new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      }),
    ]);

    if (signal.aborted) return;
  }

  onFailed(`Failed to reconnect after ${MAX_RECONNECT_ATTEMPTS} attempts.`);
}

export function useReconnect({
  config,
  password,
  status,
  onReconnecting,
  onConnected,
  onFailed,
}: UseReconnectOptions) {
  const healthRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const abortRef = useRef<AbortController | null>(null);

  const clearHealthPing = useCallback(() => {
    if (healthRef.current !== null) {
      clearInterval(healthRef.current);
      healthRef.current = null;
    }
  }, []);

  const stopReconnect = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const startReconnect = useCallback(() => {
    stopReconnect();
    if (!config) return;

    const controller = new AbortController();
    abortRef.current = controller;

    void reconnectLoop(
      config,
      password,
      controller.signal,
      onReconnecting,
      onConnected,
      onFailed,
    );
  }, [config, onConnected, onFailed, onReconnecting, password, stopReconnect]);

  const checkHealth = useCallback(async () => {
    if (!config || status !== "connected") return;

    try {
      const result = await testConnection(config, password);
      if (!result.healthy) {
        startReconnect();
      }
    } catch {
      startReconnect();
    }
  }, [config, password, startReconnect, status]);

  // Health ping interval
  useEffect(() => {
    if (status === "connected" && config) {
      healthRef.current = setInterval(() => {
        void checkHealth();
      }, HEALTH_PING_INTERVAL);
    } else {
      clearHealthPing();
    }

    return clearHealthPing;
  }, [checkHealth, clearHealthPing, config, status]);

  // Auto-reconnect on error status
  useEffect(() => {
    if (status === "error" && config) {
      startReconnect();
    } else if (status === "connected" || status === "disconnected") {
      stopReconnect();
    }
  }, [config, startReconnect, status, stopReconnect]);

  // Background/foreground reconnection
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      const wasBackground =
        appStateRef.current === "background" ||
        appStateRef.current === "inactive";
      appStateRef.current = nextState;

      if (wasBackground && nextState === "active") {
        void checkHealth();
      }
    });

    return () => sub.remove();
  }, [checkHealth]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopReconnect();
      clearHealthPing();
    };
  }, [clearHealthPing, stopReconnect]);
}
