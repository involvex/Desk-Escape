import type { FileNode } from "@opencode-ai/sdk/client";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ChevronLeft } from "lucide-react-native";
import { useFileList } from "@/api/hooks";
import { useConnection } from "@/context/ConnectionContext";
import { useTheme } from "@/context/ThemeContext";
import { getFileIcon } from "@/utils/file-icon";

export function LandscapeFileRail() {
  const { colors, spacing, typography } = useTheme();
  const { addContextAttachment } = useConnection();
  const [currentPath, setCurrentPath] = useState(".");
  const { data = [], isLoading } = useFileList(currentPath);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          backgroundColor: colors.surface,
          borderRightColor: colors.border,
          borderRightWidth: 1,
          flex: 1,
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
    [colors, spacing, typography],
  );

  const nodes = data as FileNode[];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {currentPath !== "." ? (
          <Pressable
            onPress={() => {
              const parent = currentPath.replace(/\\/g, "/").split("/");
              parent.pop();
              setCurrentPath(parent.length ? parent.join("/") : ".");
            }}
          >
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
            <Text style={styles.empty}>No files in this directory.</Text>
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
                <Icon color={colors.accent} size={16} />
                <Text numberOfLines={1} style={styles.itemText}>
                  {item.name}
                </Text>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}
