import { useMemo } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { X } from "lucide-react-native";

import { useFileContent } from "@/api/hooks";
import {
  formatBytes,
  isMarkdownPath,
  languageLabel,
} from "@/api/opencode/file-content";
import { useTheme } from "@/context/ThemeContext";
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";

interface FileViewerSheetProps {
  /** Workspace-relative path, or `null` when the viewer is closed. */
  path: string | null;
  onClose: () => void;
}

/** Basename for the header, so a long nested path does not fill the title bar. */
function baseName(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

/**
 * Full-screen viewer for a single file.
 *
 * Mounted unconditionally and driven by `path`, so opening a second file does not
 * have to tear down and rebuild the modal - only the query key changes.
 *
 * The body is chosen by what the bytes turned out to be, not by the extension:
 * markdown formats render as markdown, everything else renders as preformatted
 * text, and binary or oversized bodies get an explanation instead of a screenful
 * of replacement characters.
 */
export function FileViewerSheet({ path, onClose }: FileViewerSheetProps) {
  const { colors, spacing, typography } = useTheme();
  const visible = path !== null;

  const { data, isLoading, isError } = useFileContent(path, visible);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        backdrop: {
          backgroundColor: colors.background,
          flex: 1,
          paddingTop: spacing.xl,
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
        close: {
          alignItems: "center",
          height: 32,
          justifyContent: "center",
          width: 32,
        },
        title: {
          color: colors.text,
          flex: 1,
          fontSize: typography.subtitle,
          fontWeight: "600",
        },
        meta: {
          color: colors.textMuted,
          fontSize: typography.caption,
          paddingBottom: spacing.sm,
          paddingHorizontal: spacing.md,
          paddingTop: spacing.sm,
        },
        metaRow: {
          flexDirection: "row",
          gap: spacing.sm,
        },
        body: {
          flex: 1,
          paddingHorizontal: spacing.md,
        },
        text: {
          color: colors.text,
          fontFamily: "monospace",
          fontSize: typography.caption,
          lineHeight: typography.caption * 1.5,
        },
        notice: {
          color: colors.textMuted,
          fontSize: typography.body,
          padding: spacing.lg,
        },
      }),
    [colors, spacing, typography],
  );

  const language = path ? languageLabel(path) : null;
  const body = (() => {
    if (isLoading) {
      return <ActivityIndicator color={colors.accent} style={styles.notice} />;
    }

    if (isError) {
      return (
        <Text style={styles.notice}>
          This file could not be read. It may have been deleted or moved.
        </Text>
      );
    }

    if (!data) {
      return null;
    }

    switch (data.kind) {
      case "empty":
        return <Text style={styles.notice}>This file is empty.</Text>;

      case "binary":
        return (
          <Text style={styles.notice}>
            {`${formatBytes(data.size)} of binary data. Long-press the file to attach its path to the prompt.`}
          </Text>
        );

      case "too-large":
        return (
          <Text style={styles.notice}>
            {`Too large to display (${formatBytes(data.size)}). The limit is ${formatBytes(
              data.limit,
            )}. Long-press the file to attach its path to the prompt.`}
          </Text>
        );

      case "text":
        // Markdown only where markdown is the format. Everything else stays
        // preformatted so indentation and line structure survive.
        return path && isMarkdownPath(path) ? (
          <ScrollView contentContainerStyle={styles.body} style={styles.body}>
            <MarkdownRenderer content={data.text} />
          </ScrollView>
        ) : (
          // One vertical ScrollView with a horizontally-scrolling content row.
          // Two nested vertical ScrollViews would fight over the gesture.
          <ScrollView contentContainerStyle={styles.body} style={styles.body}>
            <ScrollView horizontal showsHorizontalScrollIndicator>
              <Text selectable style={styles.text}>
                {data.text}
              </Text>
            </ScrollView>
          </ScrollView>
        );
    }
  })();

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      visible={visible}
    >
      <View style={styles.backdrop}>
        <View style={styles.header}>
          <Text numberOfLines={1} style={styles.title}>
            {path ? baseName(path) : ""}
          </Text>
          <Pressable
            accessibilityLabel="Close file viewer"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onClose}
            style={styles.close}
          >
            <X color={colors.text} size={22} />
          </Pressable>
        </View>

        {path ? (
          <View style={styles.meta}>
            <Text numberOfLines={1} style={styles.metaRow}>
              {path}
            </Text>
            {language || data?.kind === "text" ? (
              <View style={styles.metaRow}>
                {language ? (
                  <Text style={styles.metaRow}>{language}</Text>
                ) : null}
                {data?.kind === "text" ? (
                  <Text style={styles.metaRow}>
                    {formatBytes(data.size)}
                    {data.truncated ? " (truncated)" : ""}
                  </Text>
                ) : null}
                {data?.kind === "binary" || data?.kind === "too-large" ? (
                  <Text style={styles.metaRow}>{formatBytes(data.size)}</Text>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {body}
      </View>
    </Modal>
  );
}
