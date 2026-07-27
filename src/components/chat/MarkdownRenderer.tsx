import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Markdown, { type ASTNode } from "react-native-markdown-display";
import { Copy, Check, Terminal } from "lucide-react-native";
import { useTheme } from "@/context/ThemeContext";

interface MarkdownRendererProps {
  content: string;
  onRunCommand?: (command: string) => void;
}

interface CodeBlockProps {
  language: string | null;
  children: string;
  onRunCommand?: (command: string) => void;
}

function CodeBlock({ language, children, onRunCommand }: CodeBlockProps) {
  const { colors, spacing, typography } = useTheme();
  const [copied, setCopied] = useState(false);

  const trimmed = children.replace(/\n$/, "");

  const handleCopy = useCallback(() => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(trimmed);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [trimmed]);

  const handleRun = useCallback(() => {
    onRunCommand?.(trimmed);
  }, [onRunCommand, trimmed]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          borderRadius: 10,
          borderWidth: 1,
          borderColor: colors.border,
          marginTop: spacing.xs,
          overflow: "hidden",
        },
        header: {
          alignItems: "center",
          backgroundColor: colors.surfaceElevated,
          borderBottomColor: colors.border,
          borderBottomWidth: 1,
          flexDirection: "row",
          justifyContent: "space-between",
          paddingHorizontal: spacing.sm,
          paddingVertical: spacing.xs,
        },
        langText: {
          color: colors.textMuted,
          fontSize: typography.caption - 1,
          fontWeight: "600",
          textTransform: "uppercase",
        },
        actions: {
          flexDirection: "row",
          gap: spacing.xs,
        },
        actionButton: {
          alignItems: "center",
          borderRadius: 6,
          paddingHorizontal: spacing.xs,
          paddingVertical: 3,
        },
        actionText: {
          color: colors.accent,
          fontSize: typography.caption - 1,
          fontWeight: "600",
        },
        codeScroll: {
          backgroundColor: colors.surface,
          maxHeight: 300,
        },
        code: {
          color: colors.text,
          fontFamily: "monospace",
          fontSize: typography.mono,
          lineHeight: 20,
          paddingHorizontal: spacing.sm,
          paddingVertical: spacing.sm,
        },
      }),
    [colors, spacing, typography],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.langText}>{language ?? "code"}</Text>
        <View style={styles.actions}>
          {onRunCommand ? (
            <Pressable onPress={handleRun} style={styles.actionButton}>
              <Terminal color={colors.accent} size={12} />
              <Text style={styles.actionText}>Run</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={handleCopy} style={styles.actionButton}>
            {copied ? (
              <Check color={colors.success} size={12} />
            ) : (
              <Copy color={colors.accent} size={12} />
            )}
            <Text style={styles.actionText}>{copied ? "Copied" : "Copy"}</Text>
          </Pressable>
        </View>
      </View>
      <ScrollView horizontal style={styles.codeScroll}>
        <Text selectable style={styles.code}>
          {trimmed}
        </Text>
      </ScrollView>
    </View>
  );
}

export const MarkdownRenderer = memo(function MarkdownRendererInner({
  content,
  onRunCommand,
}: MarkdownRendererProps) {
  const { colors, spacing, typography } = useTheme();

  const markdownStyles = useMemo(
    () =>
      StyleSheet.create({
        body: {
          color: colors.text,
          fontSize: typography.body,
          lineHeight: 22,
        },
        paragraph: {
          marginTop: spacing.xs,
          marginBottom: spacing.xs,
        },
        heading1: {
          color: colors.text,
          fontSize: typography.subtitle + 2,
          fontWeight: "700",
          marginTop: spacing.sm,
          marginBottom: spacing.xs,
        },
        heading2: {
          color: colors.text,
          fontSize: typography.subtitle,
          fontWeight: "700",
          marginTop: spacing.sm,
          marginBottom: spacing.xs,
        },
        heading3: {
          color: colors.text,
          fontSize: typography.body + 1,
          fontWeight: "700",
          marginTop: spacing.sm,
          marginBottom: spacing.xs,
        },
        link: {
          color: colors.accent,
        },
        strong: {
          color: colors.text,
          fontWeight: "700",
        },
        em: {
          color: colors.text,
          fontStyle: "italic",
        },
        blockquote: {
          borderLeftColor: colors.accent,
          borderLeftWidth: 3,
          paddingLeft: spacing.sm,
          marginVertical: spacing.xs,
        },
        list_item: {
          color: colors.text,
          fontSize: typography.body,
          marginVertical: 2,
        },
        bullet_list: {
          marginVertical: spacing.xs,
        },
        ordered_list: {
          marginVertical: spacing.xs,
        },
        code_inline: {
          backgroundColor: colors.surfaceElevated,
          color: colors.accent,
          fontFamily: "monospace",
          fontSize: typography.mono,
          paddingHorizontal: 4,
          paddingVertical: 2,
          borderRadius: 4,
        },
        hr: {
          backgroundColor: colors.border,
          height: 1,
          marginVertical: spacing.sm,
        },
        table: {
          borderWidth: 1,
          borderColor: colors.border,
          marginVertical: spacing.sm,
        },
        th: {
          backgroundColor: colors.surfaceElevated,
          borderColor: colors.border,
          borderWidth: 1,
          paddingHorizontal: spacing.sm,
          paddingVertical: spacing.xs,
        },
        td: {
          borderColor: colors.border,
          borderWidth: 1,
          paddingHorizontal: spacing.sm,
          paddingVertical: spacing.xs,
        },
        th_text: {
          color: colors.text,
          fontWeight: "700",
          fontSize: typography.caption,
        },
        tr: {},
        td_text: {
          color: colors.text,
          fontSize: typography.body,
        },
        fence: {
          // handled by custom renderer
        },
        image: {
          marginVertical: spacing.sm,
          borderRadius: 8,
        },
      }),
    [colors, spacing, typography],
  );

  const renderFence = useCallback(
    (node: ASTNode, _children: ReactNode[]) => {
      const language = (node.attributes?.lang as string) ?? null;
      return (
        <CodeBlock
          key={node.key}
          language={language}
          onRunCommand={onRunCommand}
        >
          {node.content}
        </CodeBlock>
      );
    },
    [onRunCommand],
  );

  const rules = useMemo(
    () => ({
      fence: renderFence,
    }),
    [renderFence],
  );

  return (
    <Markdown style={markdownStyles} rules={rules}>
      {content}
    </Markdown>
  );
}, areEqual);

function areEqual(
  prev: MarkdownRendererProps,
  next: MarkdownRendererProps,
): boolean {
  return (
    prev.content === next.content && prev.onRunCommand === next.onRunCommand
  );
}
