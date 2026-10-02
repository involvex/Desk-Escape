/**
 * Re-export barrel.
 *
 * The canonical OpenCode client lives in `@/api/client`. This module previously
 * held a near-duplicate copy of it, which meant the two trees had to be kept in
 * sync by hand and could drift (the duplicate had lost the request timeout, the
 * `.error` checks and the `bestSession` preference).
 *
 * Everything now re-exports the single implementation so there is exactly one
 * place to change.
 */
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
