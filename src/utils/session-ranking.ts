import type { Session } from "@opencode-ai/sdk/client";

/**
 * Composite score for ranking sessions.
 * Higher = more relevant to resume.
 *
 * Factors (weights):
 *   recency  — minutes since last update (exponential decay, half-life 60 min)
 *   activity — summary.additions + summary.deletions (log-scaled)
 */
function recencyScore(updatedAt: number): number {
  const minutesAgo = (Date.now() - updatedAt) / 60_000;
  // exponential decay: 1.0 at now, ~0.5 at 60 min, ~0.25 at 120 min
  return Math.pow(0.5, minutesAgo / 60);
}

function activityScore(session: Session): number {
  const additions = session.summary?.additions ?? 0;
  const deletions = session.summary?.deletions ?? 0;
  const totalChanges = additions + deletions;
  // log-scale so 1 change ~ 0, 10 changes ~ 1, 100 changes ~ 2
  return Math.log10(Math.max(totalChanges, 1));
}

function compositeScore(session: Session): number {
  const recency = recencyScore(session.time.updated);
  const activity = activityScore(session);

  // weighted sum: recency dominates (75%), activity (25%)
  return recency * 0.75 + activity * 0.25;
}

/**
 * Rank sessions by composite relevance score (descending).
 * Pure function — no side effects.
 */
export function rankSessions(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => compositeScore(b) - compositeScore(a));
}

/**
 * Find the single best session from a list.
 * Returns null if the list is empty.
 */
export function bestSession(sessions: Session[]): Session | null {
  if (sessions.length === 0) return null;
  return rankSessions(sessions)[0] ?? null;
}
