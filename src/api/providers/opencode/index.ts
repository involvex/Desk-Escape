export { OpenCodeProvider, createOpenCodeProvider } from "./provider";

// Single canonical implementations -- see the note in `./client.ts`.
export {
  buildConnectionConfig,
  clearClientCache,
  configToTargetUrl,
  createAuthHeader,
  createAuthenticatedClient,
  ensureSession,
  fetchCurrentProject,
  fetchProjectList,
  getClientCacheKey,
  getWorktreeName,
  parseTarget,
  testConnection,
} from "@/api/client";
export { EventBus } from "@/api/event-bus";
export {
  applyStreamEvent,
  isAgentBusyEvent,
  shouldRefetchMessages,
} from "@/api/message-stream";
export type {
  AgentProvider,
  AgentProviderType,
  AnyConnectionConfig,
  CursorConnectionConfig,
  HealthResult,
  OpenCodeConnectionConfig,
  ProviderConnectionConfig,
  ProviderSession,
} from "@/api/providers/types";
