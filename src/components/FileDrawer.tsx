import type { FileNode } from "@opencode-ai/sdk/client";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { ChevronLeft, File, Folder } from "lucide-react-native";
import { useFileList } from "@/api/hooks";
import { useConnection } from "@/context/ConnectionContext";
import { useTheme } from "@/context/ThemeContext";

interface FileDrawerProps {
  visible: boolean;
  onClose: () => void;
}

export function FileDrawer({ visible, onClose }: FileDrawerProps) {
  const { colors, spacing, typography } = useTheme();
  const { addContextAttachment } = useConnection();
  const [currentPath, setCurrentPath] = useState(".");
  const translateX = useSharedValue(-320);
  const { data = [], isLoading } = useFileList(currentPath);

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
          width: 300,
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
  }));

  useEffect(() => {
    // Reanimated shared values are intentionally mutated on the UI thread.
    // eslint-disable-next-line react-hooks/immutability
    translateX.value = withTiming(visible ? 0 : -320, { duration: 220 });
  }, [visible, translateX]);

  const nodes = data as FileNode[];

  return (
    <>
      {visible ? <Pressable onPress={onClose} style={styles.backdrop} /> : null}
      <Animated.View
        pointerEvents={visible ? "auto" : "none"}
        style={[styles.drawer, animatedStyle]}
      >
        <View style={styles.header}>
          {currentPath !== "." ? (
            <Pressable
              onPress={() => {
                const parent = currentPath.replace(/\\/g, "/").split("/");
                parent.pop();
                setCurrentPath(parent.length ? parent.join("/") : ".");
              }}
            >
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
              <Text style={styles.empty}>
                No files found in this directory.
              </Text>
            }
            renderItem={({ item }) => {
              const Icon = item.type === "directory" ? Folder : File;

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
