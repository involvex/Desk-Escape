import { useCallback } from "react";
import { CursorProvider } from "./provider";
import type {
  CursorConnectionConfig,
  ProviderSession,
} from "@/api/providers/types";
import type { MessageWithParts } from "@/types/opencode";

export function useCursorSessions(provider: CursorProvider | null) {
  return useCallback(async (): Promise<ProviderSession[]> => {
    if (!provider) throw new Error("Not connected");
    return provider.listSessions();
  }, [provider]);
}

export function useCursorCreateSession(provider: CursorProvider | null) {
  return useCallback(
    async (title?: string): Promise<ProviderSession> => {
      if (!provider) throw new Error("Not connected");
      return provider.createSession(title);
    },
    [provider],
  );
}

export function useCursorSelectSession(provider: CursorProvider | null) {
  return useCallback(
    async (id: string): Promise<ProviderSession> => {
      if (!provider) throw new Error("Not connected");
      return provider.selectSession(id);
    },
    [provider],
  );
}

export function useCursorDeleteSession(provider: CursorProvider | null) {
  return useCallback(
    async (id: string): Promise<void> => {
      if (!provider) throw new Error("Not connected");
      return provider.deleteSession(id);
    },
    [provider],
  );
}

export function useCursorGetMessages(provider: CursorProvider | null) {
  return useCallback(async (): Promise<MessageWithParts[]> => {
    if (!provider) throw new Error("Not connected");
    const agentId = provider.currentAgentId;
    if (!agentId) throw new Error("No agent selected");
    return provider.getMessages(agentId);
  }, [provider]);
}

export function useCursorSendPrompt(provider: CursorProvider | null) {
  return useCallback(
    async (text: string): Promise<void> => {
      if (!provider) throw new Error("Not connected");
      const agentId = provider.currentAgentId;
      if (!agentId) throw new Error("No agent selected");
      return provider.sendPrompt(agentId, text);
    },
    [provider],
  );
}

export function useCursorTestConnection(config: CursorConnectionConfig) {
  return useCallback(
    async (password?: string): Promise<{ healthy: boolean }> => {
      const provider = new CursorProvider();
      return provider.testConnection(config, password);
    },
    [config],
  );
}
