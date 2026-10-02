import type { OpenCodeClient } from "@opencode/client";
import { useEffect, useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { X } from "lucide-react-native";
import { useQuery } from "@tanstack/react-query";
import { toFileDiffEntry } from "@/api/opencode/adapter";
import { toOpenCodeError } from "@/api/opencode/errors";
import { withLocation } from "@/api/opencode/location";
import { useConnection } from "@/context/ConnectionContext";
import { useTheme } from "@/context/ThemeContext";
import type { DiffHunk, DiffLine, FileDiffEntry } from "@/types/opencode";

interface UnifiedDiffProps {
  visible: boolean;
  onClose: () => void;
}

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
 * Workspace changes, with the active session's diff as a fallback.
 *
 * V1 exposed a diff through `file.read(...).data.diff`; that field is gone in
 * V2 — `file.read` now returns raw bytes and diffs live on `vcs.diff` /
 * `session.diff`. V2 also throws instead of returning `{ data, error }`, so
 * both branches are handled explicitly rather than by inspecting `.error`.
 */
function useWorkspaceDiff() {
  const { client: rawClient, activeDirectory, sessionId } = useConnection();
  // The connection context still carries the pre-migration client type; narrow
  // it to the V2 surface this panel depends on.
  const client: OpenCodeClient | null = rawClient;

  return useQuery({
    enabled: Boolean(client),
    queryKey: ["workspace-diff", activeDirectory ?? "default", sessionId],
    queryFn: async (): Promise<FileDiffEntry[]> => {
      if (!client) {
        return [];
      }

      const workspace = await loadWorkspaceDiff(client, activeDirectory);
      if (workspace.length > 0 || !sessionId) {
        return workspace;
      }

      return loadSessionDiff(client, sessionId);
    },
  });
}

function getLineVisual(
  type: DiffLine["type"],
  colors: ReturnType<typeof useTheme>["colors"],
) {
  switch (type) {
    case "add":
      return {
        backgroundColor: "rgba(52, 211, 153, 0.18)",
        color: colors.success,
      };
    case "remove":
      return {
        backgroundColor: "rgba(248, 113, 113, 0.18)",
        color: colors.danger,
      };
    default:
      return {
        backgroundColor: "transparent",
        color: colors.textMuted,
      };
  }
}

export function UnifiedDiff({ visible, onClose }: UnifiedDiffProps) {
  const { colors, spacing, typography } = useTheme();
  const {
    data: fileDiffs = [],
    error,
    isLoading,
    refetch,
  } = useWorkspaceDiff();
  const { width: screenWidth } = useWindowDimensions();
  const translateX = useSharedValue(screenWidth);

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
        fileTitle: {
          color: colors.text,
          fontSize: typography.body,
          fontWeight: "600",
          marginBottom: spacing.sm,
          marginTop: spacing.md,
        },
        hunkHeader: {
          color: colors.textMuted,
          fontFamily: "monospace",
          fontSize: typography.mono,
          marginBottom: spacing.xs,
        },
        line: {
          fontFamily: "monospace",
          fontSize: typography.mono,
          paddingHorizontal: spacing.sm,
          paddingVertical: 2,
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

  // A patch can legitimately be absent for binary files, so an empty hunk list
  // is reported per file rather than treated as a failure.
  const message = error
    ? toOpenCodeError(error).message
    : fileDiffs.length === 0
      ? "No tracked changes returned by the host workspace."
      : null;

  return (
    <>
      {visible ? <Pressable onPress={onClose} style={styles.backdrop} /> : null}
      <Animated.View
        pointerEvents={visible ? "auto" : "none"}
        style={[styles.panel, animatedStyle]}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Changes</Text>
          <Pressable onPress={onClose}>
            <X color={colors.text} size={20} />
          </Pressable>
        </View>

        {isLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
        ) : (
          <ScrollView>
            {message ? <Text style={styles.empty}>{message}</Text> : null}
            {fileDiffs.map((file) => (
              <View key={file.path} style={{ paddingHorizontal: spacing.md }}>
                <Text style={styles.fileTitle}>{file.path}</Text>
                {file.hunks.length === 0 ? (
                  <Text style={styles.empty}>No patch content available.</Text>
                ) : (
                  file.hunks.map((hunk: DiffHunk) => (
                    <View key={`${file.path}-${hunk.header}`}>
                      <Text style={styles.hunkHeader}>{hunk.header}</Text>
                      {hunk.lines.map((line, index) => {
                        const visual = getLineVisual(line.type, colors);
                        return (
                          <Text
                            key={`${hunk.header}-${index}`}
                            style={[styles.line, visual]}
                          >
                            {`${line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}${line.content}`}
                          </Text>
                        );
                      })}
                    </View>
                  ))
                )}
              </View>
            ))}
            <Pressable
              onPress={() => void refetch()}
              style={{ padding: spacing.md }}
            >
              <Text style={{ color: colors.accent }}>Refresh diff</Text>
            </Pressable>
          </ScrollView>
        )}
      </Animated.View>
    </>
  );
}
