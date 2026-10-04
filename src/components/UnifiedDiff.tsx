import type { OpenCodeClient, VcsFileStatus } from "@opencode/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { ChevronDown, ChevronRight, X } from "lucide-react-native";
import { useQuery } from "@tanstack/react-query";
import {
  countTotals,
  describeSection,
  filterSections,
  toggleCollapsed,
  toDiffSections,
  withUntracked,
  type DiffRow,
  type DiffSection,
} from "@/api/diff-view";
import { toFileDiffEntry } from "@/api/opencode/adapter";
import { toOpenCodeError } from "@/api/opencode/errors";
import { withLocation } from "@/api/opencode/location";
import { useConnection } from "@/context/ConnectionContext";
import { useTheme } from "@/context/ThemeContext";
import type { FileDiffEntry } from "@/types/opencode";

interface UnifiedDiffProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * How often the panel re-reads the working tree on its own.
 *
 * The agent writes files continuously while it works, so a panel the user has to
 * refresh by hand shows a stale answer to "what did it just change?" -- which is
 * the only reason to have the panel open. 15s is a compromise: `useFileStatus`
 * already polls the same endpoint at 30s, and a shorter interval would double the
 * server's VCS work for a screen that is usually closed.
 *
 * The interval only ever runs while the panel is open. `WorkspaceScreen` mounts this
 * component unconditionally and hides it with `pointerEvents`, so "mounted" is not
 * "wanted": without the `visible` gate in `useWorkspaceDiff` below, a panel that is
 * never opened still fetched all three endpoints every 15s and rebuilt the whole row
 * model, which is the one cost the note above describes and the one this avoids.
 */
const AUTO_REFRESH_MS = 15_000;

/**
 * Errors that mean "this host cannot serve diffs", as opposed to "the request
 * failed". `vcs.*` is absent on a workspace that is not a git repository, and a
 * server older than the diff endpoints answers 404. Neither is worth surfacing
 * as a failure — the panel just stays empty.
 */
function isMissingDiffSupport(error: unknown): boolean {
  const kind = toOpenCodeError(error).kind;
  return kind === "not-found" || kind === "invalid-request";
}

/**
 * A workspace listing, or `null` when the host cannot produce one.
 *
 * `file.list` is what makes an untracked file recoverable at all: `vcs.diff`
 * cannot report a file git has never seen, and `vcs.status` cannot either now
 * that V2 dropped the `"untracked"` status. A failure here is tolerated rather
 * than thrown, because a host without `file.list` still has a perfectly good
 * tracked-file diff and losing that would be worse than losing the new files.
 */
async function loadListedPaths(
  client: OpenCodeClient,
  directory: string | null,
): Promise<string[] | null> {
  try {
    const result = await client.file.list(withLocation(directory));
    return result.data.map((entry) => entry.path);
  } catch {
    return null;
  }
}

async function loadStatuses(
  client: OpenCodeClient,
  directory: string | null,
): Promise<VcsFileStatus[] | null> {
  try {
    const result = await client.vcs.status(withLocation(directory));
    return result.data;
  } catch {
    return null;
  }
}

async function loadWorkspaceDiff(
  client: OpenCodeClient,
  directory: string | null,
): Promise<FileDiffEntry[]> {
  try {
    const result = await client.vcs.diff({
      ...withLocation(directory),
      // "working" is the uncommitted working-tree diff, which is what this panel
      // showed in V1. V2 also offers "branch" and "committed".
      mode: "working",
    });
    return result.data.map(toFileDiffEntry);
  } catch (error) {
    if (isMissingDiffSupport(error)) {
      return [];
    }
    throw error;
  }
}

/**
 * Diff the session produced, used when the workspace has no VCS to diff against
 * (or when that VCS is too old to expose `vcs.diff`).
 */
async function loadSessionDiff(
  client: OpenCodeClient,
  sessionId: string,
): Promise<FileDiffEntry[]> {
  try {
    // Session endpoints are fixed to the location the session was created in
    // and reject a `location` argument outright, so none is passed here.
    const result = await client.session.diff({ sessionID: sessionId });
    return result.map(toFileDiffEntry);
  } catch (error) {
    if (isMissingDiffSupport(error)) {
      return [];
    }
    throw error;
  }
}

/**
 * Workspace changes, with untracked files reconstructed and the active session's
 * diff as a fallback.
 *
 * V1 exposed a diff through `file.read(...).data.diff`; that field is gone in
 * V2 — `file.read` now returns raw bytes and diffs live on `vcs.diff` /
 * `session.diff`. V2 also throws instead of returning `{ data, error }`, so
 * both branches are handled explicitly rather than by inspecting `.error`.
 *
 * `visible` is part of `enabled` and nothing else. The caller mounts this component
 * whether or not the panel is showing, so without it the query would run -- and
 * `refetchInterval` would keep running -- against a screen nobody is looking at. Three
 * requests every 15s, one of which lists every path in the workspace, is not a price
 * worth paying for a panel that is usually closed.
 *
 * The session fallback is deliberately *not* run through `withUntracked`: it
 * reports the changes this session made rather than the working tree, so
 * subtracting the VCS status from it would be subtracting the wrong set.
 */
function useWorkspaceDiff(visible: boolean) {
  const { client: rawClient, activeDirectory, sessionId } = useConnection();
  // The connection context still carries the pre-migration client type; narrow
  // it to the V2 surface this panel depends on.
  const client: OpenCodeClient | null = rawClient;

  return useQuery({
    enabled: Boolean(client) && visible,
    queryKey: ["workspace-diff", activeDirectory ?? "default", sessionId],
    refetchInterval: AUTO_REFRESH_MS,
    queryFn: async (): Promise<WorkspaceDiff> => {
      if (!client) {
        return { files: [], untrackedPaths: new Set() };
      }

      const workspace = await loadWorkspaceDiff(client, activeDirectory);
      if (workspace.length > 0 || !sessionId) {
        return withListing(client, activeDirectory, workspace);
      }

      // The session fallback reports what this session changed rather than the
      // working tree, and is deliberately not run through `withUntracked`:
      // subtracting the VCS status set from it would subtract the wrong set.
      return {
        files: await loadSessionDiff(client, sessionId),
        untrackedPaths: new Set(),
      };
    },
  });
}

/**
 * A diff plus which of its files were reconstructed rather than reported.
 *
 * Kept together because a `FileDiffEntry` cannot say it on its own: an untracked
 * file and a mode-only change both arrive as "no hunks", and labelling them the
 * same would claim a tracked file is new.
 */
interface WorkspaceDiff {
  files: FileDiffEntry[];
  untrackedPaths: ReadonlySet<string>;
}

/** Widen a tracked diff with whatever untracked files can be recovered. */
async function withListing(
  client: OpenCodeClient,
  directory: string | null,
  files: FileDiffEntry[],
): Promise<WorkspaceDiff> {
  // Both are needed: the status set says what git already knows, and the listing
  // says what exists. A file in the listing and absent from the status set is
  // untracked. Issuing them together rather than in sequence halves the latency
  // this adds to the tracked-file path.
  const [listed, statuses] = await Promise.all([
    loadListedPaths(client, directory),
    loadStatuses(client, directory),
  ]);

  if (listed === null || statuses === null) {
    // Half the reconstruction is worse than none: without both, every listed file
    // would be reported as new.
    return { files, untrackedPaths: new Set() };
  }
  return withUntracked(files, listed, statuses);
}

export function UnifiedDiff({ visible, onClose }: UnifiedDiffProps) {
  const { colors, spacing, typography } = useTheme();
  const {
    data: diff,
    error,
    isLoading,
    isRefetching,
    refetch,
  } = useWorkspaceDiff(visible);
  const fileDiffs = diff?.files;
  const untrackedPaths = diff?.untrackedPaths;
  const { width: screenWidth } = useWindowDimensions();
  const translateX = useSharedValue(screenWidth);

  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  // Derived rather than defaulted with `?? []`, because a fresh empty array on
  // every render is a new `useMemo` dependency and defeats the memo entirely.
  const sections = useMemo(
    () => toDiffSections(fileDiffs ?? [], { untrackedPaths }),
    [fileDiffs, untrackedPaths],
  );
  const visibleSections = useMemo(
    () => filterSections(sections, filter),
    [sections, filter],
  );
  const totals = useMemo(() => countTotals(sections), [sections]);

  // A collapsed file contributes no rows, so its body is never built. That is the
  // other half of why this panel stopped hanging: a 4,000-line diff behind ten
  // collapsed headers renders ten headers.
  //
  // `SectionList` takes each section flattened *plus* its rows
  // (`SectionListData<SectionT, ItemT> = SectionT & { data: ItemT[] }`), so the
  // section's own fields ride along rather than being nested under a key.
  const listSections = useMemo(
    () =>
      visibleSections.map((section) => ({
        ...section,
        data: collapsed.has(section.path) ? [] : section.rows,
      })),
    [visibleSections, collapsed],
  );

  const onToggle = useCallback(
    (path: string) => setCollapsed((current) => toggleCollapsed(current, path)),
    [],
  );

  /**
   * Closing clears the filter and the collapsed set.
   *
   * Done here rather than in an effect on `visible`: an effect that calls
   * `setState` runs after the render that hides the panel, so it triggers a
   * second render to change state nothing can see. The close handler is the event
   * that caused the transition, so resetting in it is both cheaper and honest
   * about why the panel reopens clean.
   */
  const handleClose = useCallback(() => {
    setFilter("");
    setCollapsed(new Set());
    onClose();
  }, [onClose]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        backdrop: {
          ...StyleSheet.absoluteFill,
          backgroundColor: "rgba(0,0,0,0.45)",
        },
        panel: {
          backgroundColor: colors.surface,
          borderLeftColor: colors.border,
          borderLeftWidth: 1,
          height: "100%",
          maxWidth: 480,
          paddingTop: spacing.lg,
          position: "absolute",
          right: 0,
          top: 0,
          width: "88%",
        },
        header: {
          alignItems: "center",
          borderBottomColor: colors.border,
          borderBottomWidth: 1,
          flexDirection: "row",
          justifyContent: "space-between",
          paddingBottom: spacing.md,
          paddingHorizontal: spacing.md,
        },
        title: {
          color: colors.text,
          fontSize: typography.subtitle,
          fontWeight: "600",
        },
        summary: {
          color: colors.textMuted,
          fontSize: typography.caption,
        },
        search: {
          borderColor: colors.border,
          borderRadius: 8,
          borderWidth: 1,
          color: colors.text,
          fontSize: typography.body,
          marginHorizontal: spacing.md,
          marginTop: spacing.sm,
          paddingHorizontal: spacing.sm,
          paddingVertical: spacing.xs,
        },
        fileHeader: {
          alignItems: "center",
          flexDirection: "row",
          gap: spacing.xs,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
        },
        filePath: {
          color: colors.text,
          flex: 1,
          fontSize: typography.body,
          fontWeight: "600",
        },
        fileCounts: {
          color: colors.textMuted,
          fontSize: typography.caption,
        },
        hunkHeader: {
          color: colors.textMuted,
          fontFamily: "monospace",
          fontSize: typography.mono,
          paddingHorizontal: spacing.md,
          paddingTop: spacing.sm,
        },
        line: {
          fontFamily: "monospace",
          fontSize: typography.mono,
          paddingHorizontal: spacing.md,
          paddingVertical: 1,
        },
        empty: {
          color: colors.textMuted,
          fontSize: typography.body,
          padding: spacing.md,
        },
      }),
    [colors, spacing, typography],
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  useEffect(() => {
    // Reanimated shared values are intentionally mutated on the UI thread.
    // eslint-disable-next-line react-hooks/immutability
    translateX.value = withTiming(visible ? 0 : screenWidth, {
      duration: 220,
    });
  }, [visible, screenWidth, translateX]);

  const message = error
    ? toOpenCodeError(error).message
    : sections.length === 0
      ? "No changes. Untracked files appear here once the host reports a workspace listing."
      : null;

  const renderRow = useCallback(
    ({ item }: { item: DiffRow }) => {
      if (item.kind === "hunk") {
        return <Text style={styles.hunkHeader}>{item.header}</Text>;
      }
      const { type, content } = item.line;
      const backgroundColor =
        type === "add"
          ? "rgba(52, 211, 153, 0.18)"
          : type === "remove"
            ? "rgba(248, 113, 113, 0.18)"
            : "transparent";
      const color =
        type === "add"
          ? colors.success
          : type === "remove"
            ? colors.danger
            : colors.textMuted;
      const marker = type === "add" ? "+" : type === "remove" ? "-" : " ";
      return (
        <Text style={[styles.line, { backgroundColor, color }]}>
          {`${marker}${content}`}
        </Text>
      );
    },
    [styles, colors],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: DiffSection }) => (
      <Pressable
        accessibilityRole="button"
        onPress={() => onToggle(section.path)}
        style={styles.fileHeader}
      >
        {collapsed.has(section.path) ? (
          <ChevronRight color={colors.textMuted} size={16} />
        ) : (
          <ChevronDown color={colors.textMuted} size={16} />
        )}
        <Text style={styles.filePath}>{section.title}</Text>
        <Text style={styles.fileCounts}>{describeSection(section)}</Text>
      </Pressable>
    ),
    [styles, colors, onToggle, collapsed],
  );

  return (
    <>
      {visible ? (
        <Pressable onPress={handleClose} style={styles.backdrop} />
      ) : null}
      <Animated.View
        pointerEvents={visible ? "auto" : "none"}
        style={[styles.panel, animatedStyle]}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Changes</Text>
            <Text style={styles.summary}>
              {`${sections.length} file${sections.length === 1 ? "" : "s"} · +${totals.additions} −${totals.deletions}`}
            </Text>
          </View>
          <Pressable accessibilityLabel="Close" onPress={handleClose}>
            <X color={colors.text} size={20} />
          </Pressable>
        </View>

        {isLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
        ) : (
          <SectionList
            ListEmptyComponent={
              message ? <Text style={styles.empty}>{message}</Text> : null
            }
            ListHeaderComponent={
              sections.length > 1 ? (
                <TextInput
                  autoCapitalize="none"
                  onChangeText={setFilter}
                  placeholder="Filter files"
                  placeholderTextColor={colors.textMuted}
                  style={styles.search}
                  value={filter}
                />
              ) : null
            }
            refreshControl={
              <RefreshControl
                onRefresh={() => void refetch()}
                refreshing={isRefetching}
                tintColor={colors.textMuted}
              />
            }
            renderItem={renderRow}
            renderSectionHeader={renderSectionHeader}
            sections={listSections}
            stickySectionHeadersEnabled={false}
          />
        )}
      </Animated.View>
    </>
  );
}
