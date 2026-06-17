import { useEffect, useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { X } from "lucide-react-native";
import { useQuery } from "@tanstack/react-query";
import { useConnection } from "@/context/ConnectionContext";
import { useTheme } from "@/context/ThemeContext";
import { useFileStatus } from "@/api/hooks";
import type { DiffHunk, DiffLine, FileDiffEntry } from "@/types/opencode";

interface UnifiedDiffProps {
  visible: boolean;
  onClose: () => void;
}

function parseDiff(diff: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const lines = diff.split("\n");
  let current: DiffHunk | null = null;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      current = { header: line, lines: [] };
      hunks.push(current);
      continue;
    }

    if (!current) {
      continue;
    }

    if (line.startsWith("+")) {
      current.lines.push({ type: "add", content: line.slice(1) });
    } else if (line.startsWith("-")) {
      current.lines.push({ type: "remove", content: line.slice(1) });
    } else if (line.startsWith(" ")) {
      current.lines.push({ type: "context", content: line.slice(1) });
    }
  }

  return hunks;
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

function useWorkspaceDiff() {
  const { client } = useConnection();
  const { data: changedFiles = [] } = useFileStatus();

  return useQuery({
    enabled: Boolean(client && changedFiles.length > 0),
    queryKey: ["workspace-diff", changedFiles.map((file) => file.path)],
    queryFn: async (): Promise<FileDiffEntry[]> => {
      if (!client) {
        return [];
      }

      const entries = await Promise.all(
        changedFiles.map(async (file) => {
          const result = await client.file.read({
            query: { path: file.path },
          });
          const diff = result.data?.diff ?? "";
          return {
            path: file.path,
            hunks: diff ? parseDiff(diff) : [],
          };
        }),
      );

      return entries;
    },
  });
}

export function UnifiedDiff({ visible, onClose }: UnifiedDiffProps) {
  const { colors, spacing, typography } = useTheme();
  const { data: fileDiffs = [], isLoading, refetch } = useWorkspaceDiff();
  const translateX = useSharedValue(360);

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
    translateX.value = withTiming(visible ? 0 : 360, { duration: 220 });
  }, [visible, translateX]);

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
            {fileDiffs.length === 0 ? (
              <Text style={styles.empty}>
                No tracked changes returned by the host workspace.
              </Text>
            ) : (
              fileDiffs.map((file) => (
                <View key={file.path} style={{ paddingHorizontal: spacing.md }}>
                  <Text style={styles.fileTitle}>{file.path}</Text>
                  {file.hunks.length === 0 ? (
                    <Text style={styles.empty}>
                      No patch content available.
                    </Text>
                  ) : (
                    file.hunks.map((hunk) => (
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
              ))
            )}
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
