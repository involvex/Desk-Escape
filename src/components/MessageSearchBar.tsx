import { useCallback, useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react-native";
import { useTheme } from "@/context/ThemeContext";
import type { MessageWithParts } from "@/types/opencode";

interface MessageSearchBarProps {
  visible: boolean;
  onClose: () => void;
  messages: MessageWithParts[];
  onSelectMessage: (messageId: string) => void;
  resultCount?: number;
}

interface SearchResult {
  messageId: string;
  role: string;
  snippet: string;
  matchStart: number;
  matchEnd: number;
}

function highlightText(
  text: string,
  query: string,
): { text: string; isMatch: boolean }[] {
  if (!query.trim()) {
    return [{ text, isMatch: false }];
  }

  const results: { text: string; isMatch: boolean }[] = [];
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let lastIndex = 0;

  let index = lowerText.indexOf(lowerQuery, lastIndex);
  while (index !== -1) {
    if (index > lastIndex) {
      results.push({
        text: text.slice(lastIndex, index),
        isMatch: false,
      });
    }
    results.push({
      text: text.slice(index, index + query.length),
      isMatch: true,
    });
    lastIndex = index + query.length;
    index = lowerText.indexOf(lowerQuery, lastIndex);
  }

  if (lastIndex < text.length) {
    results.push({
      text: text.slice(lastIndex),
      isMatch: false,
    });
  }

  return results;
}

function getMessageText(parts: MessageWithParts["parts"]): string {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => ("text" in part ? part.text : ""))
    .join("\n")
    .trim();
}

function searchMessages(
  messages: MessageWithParts[],
  query: string,
): SearchResult[] {
  if (!query.trim()) return [];

  const results: SearchResult[] = [];
  const lowerQuery = query.toLowerCase();

  for (const message of messages) {
    const text = getMessageText(message.parts);
    if (!text) continue;

    const lowerText = text.toLowerCase();
    let startIndex = 0;
    let found = false;

    while (startIndex < lowerText.length) {
      const matchIndex = lowerText.indexOf(lowerQuery, startIndex);
      if (matchIndex === -1) break;

      found = true;
      const contextStart = Math.max(0, matchIndex - 20);
      const contextEnd = Math.min(text.length, matchIndex + query.length + 40);
      const prefix = contextStart > 0 ? "..." : "";
      const suffix = contextEnd < text.length ? "..." : "";
      const snippet =
        prefix +
        text.slice(contextStart, contextEnd).replace(/\n/g, " ") +
        suffix;

      results.push({
        messageId: message.info.id,
        role: message.info.role,
        snippet,
        matchStart: matchIndex - contextStart + prefix.length,
        matchEnd: matchIndex - contextStart + prefix.length + query.length,
      });

      startIndex = matchIndex + 1;
      if (found) break; // One result per message
    }
  }

  return results;
}

export function MessageSearchBar({
  visible,
  onClose,
  messages,
  onSelectMessage,
}: MessageSearchBarProps) {
  const { colors, spacing, typography } = useTheme();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const results = useMemo(
    () => searchMessages(messages, query),
    [messages, query],
  );

  const handleSelect = useCallback(
    (messageId: string) => {
      onSelectMessage(messageId);
      onClose();
    },
    [onClose, onSelectMessage],
  );

  const handleNext = useCallback(() => {
    if (results.length === 0) return;
    const next = (selectedIndex + 1) % results.length;
    setSelectedIndex(next);
    const result = results[next];
    if (result) {
      onSelectMessage(result.messageId);
    }
  }, [results, selectedIndex, onSelectMessage]);

  const handlePrev = useCallback(() => {
    if (results.length === 0) return;
    const prev = (selectedIndex - 1 + results.length) % results.length;
    setSelectedIndex(prev);
    const result = results[prev];
    if (result) {
      onSelectMessage(result.messageId);
    }
  }, [results, selectedIndex, onSelectMessage]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        backdrop: {
          backgroundColor: "rgba(0,0,0,0.5)",
          flex: 1,
        },
        container: {
          backgroundColor: colors.surface,
          borderBottomColor: colors.border,
          borderBottomWidth: 1,
          elevation: 8,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.25,
          shadowRadius: 8,
        },
        searchRow: {
          alignItems: "center",
          flexDirection: "row",
          gap: spacing.sm,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
        },
        input: {
          backgroundColor: colors.surfaceElevated,
          borderColor: colors.border,
          borderRadius: 8,
          borderWidth: 1,
          color: colors.text,
          flex: 1,
          fontSize: typography.body,
          paddingHorizontal: spacing.sm,
          paddingVertical: spacing.xs,
        },
        navButtons: {
          flexDirection: "row",
          gap: spacing.xs,
        },
        navButton: {
          alignItems: "center",
          backgroundColor: colors.surfaceElevated,
          borderColor: colors.border,
          borderRadius: 6,
          borderWidth: 1,
          height: 32,
          justifyContent: "center",
          width: 32,
        },
        closeButton: {
          alignItems: "center",
          justifyContent: "center",
        },
        resultCount: {
          color: colors.textMuted,
          fontSize: typography.caption,
          paddingHorizontal: spacing.md,
          paddingBottom: spacing.sm,
        },
        resultItem: {
          backgroundColor: colors.surface,
          borderBottomColor: colors.border,
          borderBottomWidth: StyleSheet.hairlineWidth,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
        },
        resultItemActive: {
          backgroundColor: colors.accentMuted,
        },
        resultRole: {
          color: colors.accent,
          fontSize: typography.caption - 1,
          fontWeight: "700",
          textTransform: "uppercase",
        },
        resultSnippet: {
          color: colors.text,
          fontSize: typography.caption,
          marginTop: 2,
        },
        matchHighlight: {
          color: colors.accent,
          fontWeight: "700",
        },
        emptyText: {
          color: colors.textMuted,
          fontSize: typography.body,
          padding: spacing.lg,
          textAlign: "center",
        },
      }),
    [colors, spacing, typography],
  );

  const renderResult = ({
    item,
    index,
  }: {
    item: SearchResult;
    index: number;
  }) => {
    const snippetParts = highlightText(item.snippet, query);
    const isActive = index === selectedIndex;

    return (
      <Pressable
        onPress={() => handleSelect(item.messageId)}
        style={[styles.resultItem, isActive ? styles.resultItemActive : null]}
      >
        <Text style={styles.resultRole}>{item.role}</Text>
        <Text style={styles.resultSnippet} numberOfLines={2}>
          {snippetParts.map((part, i) => {
            const key = `${part.isMatch ? "m" : "t"}-${part.text.slice(0, 8)}-${i}`;
            return part.isMatch ? (
              <Text key={key} style={styles.matchHighlight}>
                {part.text}
              </Text>
            ) : (
              <Text key={key}>{part.text}</Text>
            );
          })}
        </Text>
      </Pressable>
    );
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent={visible}
      visible={visible}
    >
      <Pressable onPress={onClose} style={styles.backdrop} />
      <View style={styles.container}>
        <View style={styles.searchRow}>
          <Search color={colors.textMuted} size={18} />
          <TextInput
            autoFocus
            onChangeText={(text) => {
              setQuery(text);
              setSelectedIndex(0);
            }}
            placeholder="Search messages..."
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            value={query}
          />
          <View style={styles.navButtons}>
            <Pressable onPress={handlePrev} style={styles.navButton}>
              <ChevronUp color={colors.textMuted} size={16} />
            </Pressable>
            <Pressable onPress={handleNext} style={styles.navButton}>
              <ChevronDown color={colors.textMuted} size={16} />
            </Pressable>
          </View>
          <Pressable onPress={onClose} style={styles.closeButton}>
            <X color={colors.textMuted} size={20} />
          </Pressable>
        </View>
        {query.trim() ? (
          <>
            <Text style={styles.resultCount}>
              {results.length === 0
                ? "No results"
                : `${selectedIndex + 1} of ${results.length} result${results.length === 1 ? "" : "s"}`}
            </Text>
            <FlatList
              data={results}
              keyExtractor={(item) => item.messageId}
              renderItem={renderResult}
              style={{ maxHeight: 300 }}
            />
          </>
        ) : null}
      </View>
    </Modal>
  );
}
