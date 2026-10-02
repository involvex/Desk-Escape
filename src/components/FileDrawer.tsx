import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { ChevronLeft } from "lucide-react-native";
import { useFileList } from "@/api/hooks";
import { toFileEntryList } from "@/api/opencode/adapter";
import { useConnection } from "@/context/ConnectionContext";
import { useTheme } from "@/context/ThemeContext";
import { getFileIcon } from "@/utils/file-icon";

interface FileDrawerProps {
  visible: boolean;
  onClose: () => void;
}

/** Path of the parent of a workspace-relative path; `.` is the root. */
function parentPath(path: string): string {
  const segments = path.replace(/\\/g, "/").split("/").filter(Boolean);
  segments.pop();
  return segments.length ? segments.join("/") : ".";
}

export function FileDrawer({ visible, onClose }: FileDrawerProps) {
  const { colors, spacing, typography } = useTheme();
  const { addContextAttachment } = useConnection();
  const { width: screenWidth } = useWindowDimensions();
  const [currentPath, setCurrentPath] = useState(".");
  const drawerWidth = Math.min(300, screenWidth * 0.85);
  const translateX = useSharedValue(-drawerWidth);
  const { data, isLoading, isError } = useFileList(currentPath);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        backdrop: {
          ...StyleSheet.absoluteFill,
          backgroundColor: "rgba(0,0,0,0.45)",
        },
        drawer: {
          backgroundColor: colors.surface,
          borderRightColor: colors.border,
          borderRightWidth: 1,
          height: "100%",
          left: 0,
          paddingTop: spacing.lg,
          position: "absolute",
          top: 0,
        },
        header: {
          alignItems: "center",
          borderBottomColor: colors.border,
          borderBottomWidth: 1,
          flexDirection: "row",
          gap: spacing.sm,
          paddingBottom: spacing.md,
          paddingHorizontal: spacing.md,
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
          paddingVertical: spacing.sm,
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
          fontSize: typography.body,
        },
        empty: {
          color: colors.textMuted,
          fontSize: typography.caption,
          padding: spacing.md,
        },
      }),
    [colors, spacing, typography],
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    width: drawerWidth,
  }));

  useEffect(() => {
    // Reanimated shared values are intentionally mutated on the UI thread.
    // eslint-disable-next-line react-hooks/immutability
    translateX.value = withTiming(visible ? 0 : -drawerWidth, {
      duration: 220,
    });
  }, [visible, translateX, drawerWidth]);

  // V2's `file.list` returns one flat level of `{ path, type }` with no
  // children, so the visible list is exactly the current directory's page and
  // descending means re-querying with the child path.
  const nodes = useMemo(() => toFileEntryList(data), [data]);

  return (
    <>
      {visible ? <Pressable onPress={onClose} style={styles.backdrop} /> : null}
      <Animated.View
        pointerEvents={visible ? "auto" : "none"}
        style={[styles.drawer, animatedStyle]}
      >
        <View style={styles.header}>
          {currentPath !== "." ? (
            <Pressable onPress={() => setCurrentPath(parentPath(currentPath))}>
              <ChevronLeft color={colors.text} size={20} />
            </Pressable>
          ) : null}
          <Text style={styles.title}>Repository</Text>
        </View>
        <Text style={styles.path}>{currentPath}</Text>

        {isLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 16 }} />
        ) : (
          <FlatList
            data={nodes}
            keyExtractor={(item) => item.path}
            ListEmptyComponent={
              // A missing directory comes back as a rejected request rather
              // than an empty list, so distinguish "no such folder" from
              // "folder is genuinely empty".
              <Text style={styles.empty}>
                {isError
                  ? "This directory could not be read."
                  : "No files found in this directory."}
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
                    }
                  }}
                  style={styles.item}
                >
                  <Icon color={colors.accent} size={18} />
                  <Text style={styles.itemText}>{item.name}</Text>
                </Pressable>
              );
            }}
          />
        )}
      </Animated.View>
    </>
  );
}
