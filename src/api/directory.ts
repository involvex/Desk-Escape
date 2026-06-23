/** OpenCode API calls are scoped by project worktree via `directory` query param. */
export function withDirectoryQuery(directory: string | null | undefined) {
  if (!directory) {
    return {};
  }

  return { query: { directory } } as const;
}
