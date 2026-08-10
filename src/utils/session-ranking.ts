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

export type SessionTimeGroup = "today" | "yesterday" | "this-week" | "older";

interface SessionGroup {
  group: SessionTimeGroup;
  label: string;
  sessions: Session[];
}

/**
 * Group sessions by time period.
 * Returns groups in order: today, yesterday, this-week, older.
 */
export function groupSessionsByTime(sessions: Session[]): SessionGroup[] {
  const now = Date.now();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayStartMs = todayStart.getTime();

  const yesterdayStart = new Date(todayStartMs - 24 * 60 * 60 * 1000);
  const weekStart = new Date(todayStartMs - 7 * 24 * 60 * 60 * 1000);

  const groups: Record<SessionTimeGroup, Session[]> = {
    today: [],
    yesterday: [],
    "this-week": [],
    older: [],
  };

  for (const session of sessions) {
    const updated = session.time.updated;
    if (updated >= todayStartMs) {
      groups.today.push(session);
    } else if (updated >= yesterdayStart.getTime()) {
      groups.yesterday.push(session);
    } else if (updated >= weekStart.getTime()) {
      groups["this-week"].push(session);
    } else {
      groups.older.push(session);
    }
  }

  const groupOrder: SessionTimeGroup[] = [
    "today",
    "yesterday",
    "this-week",
    "older",
  ];
  const groupLabels: Record<SessionTimeGroup, string> = {
    today: "Today",
    yesterday: "Yesterday",
    "this-week": "This week",
    older: "Older",
  };

  return groupOrder
    .map((group) => ({
      group,
      label: groupLabels[group],
      sessions: groups[group],
    }))
    .filter((g) => g.sessions.length > 0);
}

/**
 * Get a human-readable relative time string for a session.
 */
export function getSessionTimeAgo(timestamp: number, now: number): string {
  const seconds = Math.floor((now - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks === 1) return "1w ago";
  return `${weeks}w ago`;
}

/**
 * Format a timestamp as a date string (e.g., "Jan 15, 2024").
 */
export function formatSessionDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
