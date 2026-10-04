import type { PermissionSavedInfo } from "@/api/permissions";

/**
 * Query key for the persisted-grant list.
 *
 * Keyed by directory, which is a sound proxy for the project: one directory maps
 * to one project, so the same key across directories is what would wrongly show a
 * project's grants while looking at another.
 *
 * Worth being precise about *why* this is only a cache key. An earlier version of
 * this comment claimed `permission.saved.list` "takes a `projectID`" as the reason
 * for directory scoping, which reads as though a directory could be sent there.
 * It cannot. A live-server probe (`scripts/probe-server-contracts.mjs`, Q2) found
 * that a filesystem path in `projectID` is rejected exactly as a random string is,
 * because the server keys grants on an opaque id that `project.list` reports
 * separately from the path as `id` and `canonical`. The fetch therefore takes a
 * resolved project id; only this cache key stays directory-shaped.
 */
export const savedPermissionsKey = (directory?: string | null) =>
  ["saved-permissions", directory ?? "default"] as const;

/**
 * Presentation for persisted "always allow" grants.
 *
 * ## Why this needs its own screen
 *
 * Tapping "Always" on a permission banner writes a durable grant to the server
 * that outlives the session, the app, and the app being reinstalled. Until this
 * existed there was no way to see or undo one — `permission.saved.list` and
 * `.remove` were implemented in `api/permissions.ts` and called by nothing. A
 * permission the user cannot revoke is a permission they did not really grant.
 *
 * Kept pure so the labelling and ordering can be tested without React Native or
 * a server.
 */

/** One grant, as the list screen renders it. */
export interface GrantView {
  id: string;
  /** e.g. `"bash"`. */
  action: string;
  /** What was allowed — a command pattern, a path prefix. */
  resource: string;
  /** Project the grant is scoped to. Empty when the server omits it. */
  project: string;
  /**
   * Unix milliseconds of the last update, or `null` when absent or nonsensical.
   * Used for ordering only; see {@link formatGrantAge}.
   */
  updatedAt: number | null;
  /** Whether the resource reads as a whole-action grant (no specific target). */
  wildcard: boolean;
}

/** `true` when the grant covers the action wholesale rather than one target. */
export function isWildcardGrant(resource: string): boolean {
  const trimmed = resource.trim();
  // The server sends `*` for "any bash command". An empty resource is treated
  // the same way: it grants nothing specific, so labelling it as a wildcard is
  // the honest reading, and hiding that would understate the grant's reach.
  return trimmed === "" || trimmed === "*";
}

/**
 * Build the list view, most recently used first.
 *
 * Ordering is by `time.updated`, newest first, because the most recent grant is
 * the one the user is most likely to want to undo. Grants the server gave no
 * timestamp for sort last rather than being dropped — an undated grant is still
 * a live grant. Ties break on `id` so the order is stable across reloads
 * instead of shuffling every fetch.
 */
export function toGrantViews(
  grants: readonly PermissionSavedInfo[],
): GrantView[] {
  return grants
    .map((grant) => toGrantView(grant))
    .sort((a, b) => {
      if (a.updatedAt !== b.updatedAt) {
        // `?? 0` is what puts an undated grant last: `toGrantView` only ever
        // stores a timestamp it has already checked is finite and positive, so
        // every real value outranks the epoch stand-in. An explicit null branch
        // would be dead code -- deleting it was verified not to change the
        // ordering.
        return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

function toGrantView(grant: PermissionSavedInfo): GrantView {
  const raw = grant.time?.updated;
  // A negative or non-finite timestamp is a server quirk, not a real date; treat
  // it as unknown so it sorts last instead of pinning to the top of the list.
  const updatedAt =
    typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : null;

  return {
    id: grant.id,
    action: grant.action?.trim() ?? "",
    resource: grant.resource?.trim() ?? "",
    project: grant.projectID?.trim() ?? "",
    updatedAt,
    wildcard: isWildcardGrant(grant.resource ?? ""),
  };
}

/**
 * Relative age, e.g. `"just now"`, `"3d ago"`, `"2mo ago"`.
 *
 * Coarse on purpose. The exact instant a grant was created is not what the user
 * needs to decide whether to revoke it, and a relative label that silently goes
 * stale is worse than a vague one. Returns `"unknown"` when there is no usable
 * timestamp rather than implying recency that is not known.
 */
export function formatGrantAge(
  updatedAt: number | null,
  now: number = Date.now(),
): string {
  if (updatedAt === null) return "unknown";

  // A future timestamp yields a negative `seconds`, which is still below the
  // one-minute cutoff and so reports "just now". That is the intended answer
  // for device/server clock skew, and it needs no clamp -- an explicit
  // `Math.max(0, ...)` was verified to be dead.
  const seconds = Math.floor((now - updatedAt) / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  return `${Math.floor(months / 12)}y ago`;
}

/**
 * The one-line summary of what a grant permits.
 *
 * States the action and what it covers, and for a wildcard says so in words —
 * "any bash command" is materially different from `npm test`, and rendering
 * both as a bare string would hide the difference.
 */
export function describeGrant(grant: GrantView): string {
  const action = grant.action || "permission";
  if (grant.wildcard) {
    return `Any ${action} command`;
  }
  return `${action}: ${grant.resource}`;
}

/**
 * Whether revoking this grant needs a confirmation step.
 *
 * A grant covering one specific target is cheap to restore by answering the
 * prompt again. A wildcard is not: revoking it re-prompts for everything it
 * silently covered, which can mean a burst of prompts. Worth a beat.
 */
export function needsConfirmation(grant: GrantView): boolean {
  return grant.wildcard;
}
