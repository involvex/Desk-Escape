import type { Session } from "@/types/domain";

export interface ArchivePartition {
  active: Session[];
  archived: Session[];
}

/** Split sessions into active vs archived, preserving input order. */
export function partitionArchived(
  sessions: Session[],
  archivedIds: string[],
): ArchivePartition {
  const archivedSet = new Set(archivedIds);
  const active: Session[] = [];
  const archived: Session[] = [];
  for (const session of Array.isArray(sessions) ? sessions : []) {
    if (archivedSet.has(session.id)) {
      archived.push(session);
    } else {
      active.push(session);
    }
  }
  return { active, archived };
}

/** Rank with pinned IDs first, then keep existing order among peers. */
export function applyPinnedOrder(
  sessions: Session[],
  pinnedIds: string[],
): Session[] {
  if (pinnedIds.length === 0) {
    return sessions;
  }
  const pinnedSet = new Set(pinnedIds);
  const pinned: Session[] = [];
  const rest: Session[] = [];
  for (const session of sessions) {
    if (pinnedSet.has(session.id)) {
      pinned.push(session);
    } else {
      rest.push(session);
    }
  }
  // Preserve pin order from pinnedIds
  pinned.sort((a, b) => pinnedIds.indexOf(a.id) - pinnedIds.indexOf(b.id));
  return [...pinned, ...rest];
}
