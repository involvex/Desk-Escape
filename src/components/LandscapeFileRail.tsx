import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { ChevronLeft } from "lucide-react-native";
import { useFileList } from "@/api/hooks";
import { toFileEntryList } from "@/api/opencode/adapter";
import { useConnection } from "@/context/ConnectionContext";
import { useTheme } from "@/context/ThemeContext";
import { FileViewerSheet } from "@/components/FileViewerSheet";
import { getFileIcon } from "@/utils/file-icon";

/** Path of the parent of a workspace-relative path; `.` is the root. */
function parentPath(path: string): string {
  const segments = path.replace(/\\/g, "/").split("/").filter(Boolean);
  segments.pop();
  return segments.length ? segments.join("/") : ".";
}

export function LandscapeFileRail() {
  const { colors, spacing, typography } = useTheme();
  const { addContextAttachment } = useConnection();
  const { width: screenWidth } = useWindowDimensions();
  const [currentPath, setCurrentPath] = useState(".");
  // Tap opens the file, long-press attaches it to the prompt. Same split as the
  // phone drawer, so the two browsers stay predictable.
  const [viewingPath, setViewingPath] = useState<string | null>(null);
  const railWidth = Math.min(Math.max(screenWidth * 0.28, 160), 200);
  const { data, isLoading, isError } = useFileList(currentPath);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          backgroundColor: colors.surface,
          borderRightColor: colors.border,
          borderRightWidth: 1,
          flex: 1,
          minWidth: 160,
          maxWidth: 200,
          width: railWidth,
        },
        header: {
          alignItems: "center",
          borderBottomColor: colors.border,
          borderBottomWidth: 1,
          flexDirection: "row",
          gap: spacing.sm,
          padding: spacing.md,
        },
        title: {
          color: colors.text,
          flex: 1,
          fontSize: typography.subtitle,
          fontWeight: "600",
        },
        path: {
          color: colors.textMuted,
          fontSize: typography.caption,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.xs,
        },
        item: {
          alignItems: "center",
          flexDirection: "row",
          gap: spacing.sm,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
        },
        itemText: {
          color: colors.text,
          flex: 1,
          fontSize: typography.caption,
        },
        empty: {
          color: colors.textMuted,
          fontSize: typography.caption,
          padding: spacing.md,
        },
      }),
    [colors, spacing, typography, railWidth],
  );

  // V2 lists a single directory level per call and returns no nested children,
  // so `currentPath` is the whole navigation state and each level is its own
  // query keyed by that path.
  const nodes = useMemo(() => toFileEntryList(data), [data]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {currentPath !== "." ? (
          <Pressable onPress={() => setCurrentPath(parentPath(currentPath))}>
            <ChevronLeft color={colors.text} size={18} />
          </Pressable>
        ) : null}
        <Text style={styles.title}>Files</Text>
      </View>
      <Text numberOfLines={1} style={styles.path}>
        {currentPath}
      </Text>

      {isLoading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 16 }} />
      ) : (
        <FlatList
          data={nodes}
          keyExtractor={(item) => item.path}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {isError
                ? "This directory could not be read."
                : "No files in this directory."}
            </Text>
          }
          renderItem={({ item }) => {
            const Icon = getFileIcon(item.name, item.type);

            return (
              <Pressable
                onLongPress={() => {
                  if (item.type === "file") {
                    addContextAttachment(item.path);
                  }
                }}
                onPress={() => {
                  if (item.type === "directory") {
                    setCurrentPath(item.path);
                  } else {
                    setViewingPath(item.path);
                  }
                }}
                style={styles.item}
              >
                <Icon color={colors.accent} size={16} />
                <Text numberOfLines={1} style={styles.itemText}>
                  {item.name}
                </Text>
              </Pressable>
            );
          }}
        />
      )}
      <FileViewerSheet
        path={viewingPath}
        onClose={() => setViewingPath(null)}
      />
    </View>
  );
}
