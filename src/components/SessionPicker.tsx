import type { Session } from "@opencode-ai/sdk/client";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  Archive,
  Clock,
  GitBranch,
  Pin,
  Plus,
  Search,
  Share2,
  Trash2,
  X,
} from "lucide-react-native";
import { useSessions } from "@/api/hooks";
import { withDirectoryQuery } from "@/api/directory";
import { useConnection } from "@/context/ConnectionContext";
import {
  useSessionMeta,
  type SessionTemplate,
} from "@/context/SessionMetaContext";
import { useTheme } from "@/context/ThemeContext";
import { shareSessionMarkdown } from "@/utils/export-session";
import {
  rankSessionsWithPins,
  groupSessionsByTime,
  getSessionTimeAgo,
  formatSessionDate,
} from "@/utils/session-ranking";
import { partitionArchived } from "@/utils/session-meta";
import { Snackbar } from "@/components/Snackbar";
import { Swipeable } from "react-native-gesture-handler";
import type { MessageWithParts } from "@/types/opencode";

interface SessionPickerProps {
  visible: boolean;
  onClose: () => void;
}

interface SessionGroup {
  group: "today" | "yesterday" | "this-week" | "older";
  label: string;
  sessions: Session[];
}

type FlatListItem =
  | { type: "header"; section: SessionGroup }
  | { type: "item"; session: Session; section: SessionGroup };

type ListFilter = "active" | "archived";

function isHeaderItem(
  item: FlatListItem,
): item is { type: "header"; section: SessionGroup } {
  return item.type === "header";
}

export function SessionPicker({ visible, onClose }: SessionPickerProps) {
  const { colors, spacing, typography } = useTheme();
  const {
    sessionId,
    selectSession,
    createSession,
    deleteSession,
    client,
    activeDirectory,
    setCurrentAgent,
    setCurrentModel,
  } = useConnection();
  const {
    pinnedIds,
    archivedIds,
    templates,
    isPinned,
    isArchived,
    togglePin,
    toggleArchive,
  } = useSessionMeta();
  const { data: sessions = [], isLoading, refetch } = useSessions();
  const [now] = useState(() => Date.now());
  const [searchQuery, setSearchQuery] = useState("");
  const [listFilter, setListFilter] = useState<ListFilter>("active");
  const [showTemplates, setShowTemplates] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(["today", "yesterday"]),
  );
  const [snackbar, setSnackbar] = useState<{
    message: string;
    action?: { label: string; onPress: () => void };
    visible: boolean;
  }>({ message: "", visible: false });
  const [actionSession, setActionSession] = useState<Session | null>(null);

  const partitioned = useMemo(
    () => partitionArchived(sessions, archivedIds),
    [sessions, archivedIds],
  );

  const sourceSessions =
    listFilter === "archived" ? partitioned.archived : partitioned.active;

  const rankedSessions = useMemo(
    () => rankSessionsWithPins(sourceSessions, pinnedIds),
    [sourceSessions, pinnedIds],
  );

  const filteredSessions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return rankedSessions;
    return rankedSessions.filter((session) =>
      (session.title || "").toLowerCase().includes(query),
    );
  }, [rankedSessions, searchQuery]);

  const groupedSessions = useMemo(
    () => groupSessionsByTime(filteredSessions),
    [filteredSessions],
  );

  const showSnackbar = useCallback(
    (message: string, action?: { label: string; onPress: () => void }) => {
      setSnackbar({ message, action, visible: true });
    },
    [],
  );

  const hideSnackbar = useCallback(() => {
    setSnackbar({ message: "", visible: false });
  }, []);

  const handleSelect = useCallback(
    (session: Session) => {
      void selectSession(session.id)
        .then(() => onClose())
        .catch((error: unknown) => {
          console.error("Failed to select session:", error);
          onClose();
        });
    },
    [selectSession, onClose],
  );

  const handleCreate = useCallback(() => {
    void createSession().then(() => {
      void refetch();
      onClose();
    });
  }, [createSession, refetch, onClose]);

  const handleCreateFromTemplate = useCallback(
    async (template: SessionTemplate) => {
      try {
        if (template.agent) {
          setCurrentAgent(template.agent);
        }
        if (template.model) {
          setCurrentModel(template.model.providerId, template.model.modelId);
        }
        const created = await createSession(template.name);
        if (template.prompt.trim() && client) {
          await client.session.prompt({
            path: { id: created.id },
            ...withDirectoryQuery(activeDirectory),
            body: {
              parts: [{ type: "text", text: template.prompt.trim() }],
            },
          });
        }
        void refetch();
        setShowTemplates(false);
        onClose();
      } catch (error) {
        console.error("Failed to create session from template:", error);
        showSnackbar("Failed to create session from template");
      }
    },
    [
      activeDirectory,
      client,
      createSession,
      onClose,
      refetch,
      setCurrentAgent,
      setCurrentModel,
      showSnackbar,
    ],
  );

  const handleDelete = useCallback(
    (session: Session) => {
      void deleteSession(session.id).then(() => {
        void refetch();
        showSnackbar(`Deleted "${session.title || "Untitled session"}"`, {
          label: "Undo",
          onPress: () => {
            void createSession(session.title || "").then(() => {
              void refetch();
              hideSnackbar();
            });
          },
        });
      });
    },
    [deleteSession, refetch, showSnackbar, hideSnackbar, createSession],
  );

  const handleExport = useCallback(
    async (session: Session) => {
      if (!client) {
        showSnackbar("Connect to a server to export");
        return;
      }
      try {
        const result = await client.session.messages({
          path: { id: session.id },
          ...withDirectoryQuery(activeDirectory),
        });
        const messages = (result.data ?? []) as MessageWithParts[];
        await shareSessionMarkdown(session, messages);
      } catch (error) {
        console.error("Failed to export session:", error);
        showSnackbar("Export failed");
      }
    },
    [activeDirectory, client, showSnackbar],
  );

  const openSessionActions = useCallback((session: Session) => {
    setActionSession(session);
  }, []);

  const runSessionAction = useCallback(
    (action: "pin" | "archive" | "export" | "delete") => {
      if (!actionSession) return;
      const session = actionSession;
      setActionSession(null);
      switch (action) {
        case "pin": {
          const wasPinned = isPinned(session.id);
          togglePin(session.id);
          showSnackbar(wasPinned ? "Unpinned session" : "Pinned session");
          break;
        }
        case "archive": {
          const wasArchived = isArchived(session.id);
          toggleArchive(session.id);
          showSnackbar(wasArchived ? "Unarchived session" : "Archived session");
          break;
        }
        case "export":
          void handleExport(session);
          break;
        case "delete":
          Alert.alert(
            "Delete session",
            `Delete "${session.title || "Untitled session"}"?`,
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete",
                style: "destructive",
                onPress: () => handleDelete(session),
              },
            ],
          );
          break;
      }
    },
    [
      actionSession,
      handleDelete,
      handleExport,
      isArchived,
      isPinned,
      showSnackbar,
      toggleArchive,
      togglePin,
    ],
  );

  const toggleGroup = useCallback((group: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  }, []);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        backdrop: {
          backgroundColor: "rgba(0,0,0,0.55)",
          flex: 1,
          justifyContent: "flex-end",
        },
        sheet: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          maxHeight: "72%",
          paddingBottom: spacing.lg,
          paddingTop: spacing.md,
        },
        header: {
          alignItems: "center",
          flexDirection: "row",
          justifyContent: "space-between",
          paddingHorizontal: spacing.md,
          paddingBottom: spacing.md,
        },
        title: {
          color: colors.text,
          fontSize: typography.subtitle,
          fontWeight: "700",
        },
        filterRow: {
          flexDirection: "row",
          gap: spacing.sm,
          marginBottom: spacing.sm,
          marginHorizontal: spacing.md,
        },
        filterChip: {
          borderColor: colors.border,
          borderRadius: 999,
          borderWidth: 1,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.xs,
        },
        filterChipActive: {
          backgroundColor: colors.accentMuted,
          borderColor: colors.accent,
        },
        filterChipText: {
          color: colors.textMuted,
          fontSize: typography.caption,
          fontWeight: "600",
        },
        filterChipTextActive: {
          color: colors.accent,
        },
        searchContainer: {
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: colors.surfaceElevated,
          borderColor: colors.border,
          borderRadius: 12,
          borderWidth: 1,
          marginHorizontal: spacing.md,
          marginBottom: spacing.md,
          paddingHorizontal: spacing.sm,
        },
        searchInput: {
          color: colors.text,
          fontSize: typography.body,
          flex: 1,
          paddingVertical: spacing.sm,
        },
        groupHeader: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginHorizontal: spacing.md,
          marginTop: spacing.md,
          marginBottom: spacing.xs,
          paddingVertical: spacing.xs,
        },
        groupTitle: {
          color: colors.textMuted,
          fontSize: typography.caption,
          fontWeight: "600",
          textTransform: "uppercase",
          letterSpacing: 0.5,
        },
        groupCount: {
          color: colors.textMuted,
          fontSize: typography.caption,
        },
        item: {
          alignItems: "center",
          borderColor: colors.border,
          borderRadius: 12,
          borderWidth: 1,
          flexDirection: "row",
          gap: spacing.sm,
          marginBottom: spacing.sm,
          marginHorizontal: spacing.md,
          padding: spacing.md,
        },
        itemActive: {
          borderColor: colors.accent,
        },
        itemBody: {
          flex: 1,
          minWidth: 0,
        },
        itemTitle: {
          color: colors.text,
          fontSize: typography.body,
          fontWeight: "600",
        },
        itemMeta: {
          color: colors.textMuted,
          fontSize: typography.caption,
          marginTop: spacing.xs,
        },
        metaRow: {
          flexDirection: "row",
          alignItems: "center",
          flexWrap: "wrap",
          gap: spacing.sm,
          marginTop: spacing.xs,
        },
        metaItem: {
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
        },
        metaText: {
          color: colors.textMuted,
          fontSize: 10,
        },
        activityRow: {
          alignItems: "center",
          flexDirection: "row",
          gap: spacing.sm,
          marginTop: spacing.xs,
        },
        activityDot: {
          borderRadius: 999,
          height: 6,
          width: 6,
        },
        activityLabel: {
          color: colors.textMuted,
          fontSize: 10,
          fontWeight: "500",
        },
        changeBadge: {
          backgroundColor: colors.accentMuted,
          borderRadius: 6,
          paddingHorizontal: 6,
          paddingVertical: 2,
        },
        changeText: {
          color: colors.accent,
          fontSize: 10,
          fontWeight: "600",
        },
        createButton: {
          alignItems: "center",
          backgroundColor: colors.accentMuted,
          borderColor: colors.accent,
          borderRadius: 12,
          borderWidth: 1,
          flexDirection: "row",
          gap: spacing.sm,
          justifyContent: "center",
          marginBottom: spacing.sm,
          marginHorizontal: spacing.md,
          padding: spacing.md,
        },
        createText: {
          color: colors.accent,
          fontSize: typography.body,
          fontWeight: "600",
        },
        templateButton: {
          alignItems: "center",
          borderColor: colors.border,
          borderRadius: 12,
          borderWidth: 1,
          flexDirection: "row",
          gap: spacing.sm,
          justifyContent: "center",
          marginBottom: spacing.md,
          marginHorizontal: spacing.md,
          padding: spacing.sm,
        },
        templateButtonText: {
          color: colors.textMuted,
          fontSize: typography.caption,
          fontWeight: "600",
        },
        empty: {
          color: colors.textMuted,
          fontSize: typography.body,
          padding: spacing.lg,
          textAlign: "center",
        },
        rightAction: {
          alignItems: "flex-end",
          flex: 1,
          height: "100%",
          justifyContent: "center",
          paddingRight: spacing.md,
          position: "absolute",
          right: 0,
          top: 0,
        },
        deleteButton: {
          alignItems: "center",
          backgroundColor: colors.danger + "33",
          borderRadius: 8,
          justifyContent: "center",
          padding: spacing.sm,
        },
        actionSheet: {
          backgroundColor: colors.surfaceElevated,
          borderTopColor: colors.border,
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          borderTopWidth: 1,
          padding: spacing.md,
          paddingBottom: spacing.xl,
        },
        actionTitle: {
          color: colors.textMuted,
          fontSize: typography.caption,
          marginBottom: spacing.sm,
        },
        actionItem: {
          alignItems: "center",
          flexDirection: "row",
          gap: spacing.sm,
          paddingVertical: spacing.md,
        },
        actionText: {
          color: colors.text,
          fontSize: typography.body,
        },
        templateItem: {
          borderColor: colors.border,
          borderRadius: 12,
          borderWidth: 1,
          marginBottom: spacing.sm,
          marginHorizontal: spacing.md,
          padding: spacing.md,
        },
        templateName: {
          color: colors.text,
          fontSize: typography.body,
          fontWeight: "600",
        },
        templatePrompt: {
          color: colors.textMuted,
          fontSize: typography.caption,
          marginTop: spacing.xs,
        },
      }),
    [colors, spacing, typography],
  );

  const renderSectionHeader = ({ section }: { section: SessionGroup }) => {
    const isExpanded = expandedGroups.has(section.group);
    return (
      <Pressable
        onPress={() => toggleGroup(section.group)}
        style={styles.groupHeader}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.xs,
          }}
        >
          <Text style={styles.groupTitle}>{section.label}</Text>
          <Text style={styles.groupCount}>({section.sessions.length})</Text>
        </View>
        <Text
          style={{
            color: colors.textMuted,
            fontSize: 10,
            transform: [{ rotate: isExpanded ? "180deg" : "0deg" }],
          }}
        >
          ▼
        </Text>
      </Pressable>
    );
  };

  const renderItem = ({ item }: { item: Session }) => {
    const isActive = item.id === sessionId;
    const totalChanges =
      (item.summary?.additions ?? 0) + (item.summary?.deletions ?? 0);
    const minutesAgo = (now - item.time.updated) / 60_000;
    const isRecent = minutesAgo < 5;
    const pinned = isPinned(item.id);

    const renderRightActions = () => (
      <View style={styles.rightAction}>
        <Pressable
          onPress={() => handleDelete(item)}
          style={styles.deleteButton}
          hitSlop={16}
        >
          <Trash2 color={colors.danger} size={20} />
        </Pressable>
      </View>
    );

    return (
      <Swipeable
        renderRightActions={renderRightActions}
        friction={4}
        overshootFriction={2}
      >
        <View style={[styles.item, isActive ? styles.itemActive : null]}>
          <Pressable
            onPress={() => handleSelect(item)}
            onLongPress={() => openSessionActions(item)}
            style={styles.itemBody}
          >
            <View
              style={{
                alignItems: "center",
                flexDirection: "row",
                gap: spacing.xs,
              }}
            >
              {pinned ? <Pin color={colors.accent} size={14} /> : null}
              <Text style={[styles.itemTitle, { flex: 1 }]} numberOfLines={1}>
                {item.title || "Untitled session"}
              </Text>
            </View>
            <View style={styles.metaRow}>
              {item.directory ? (
                <View style={styles.metaItem}>
                  <GitBranch color={colors.textMuted} size={10} />
                  <Text style={styles.metaText} numberOfLines={1}>
                    {item.directory.split("/").pop() || item.directory}
                  </Text>
                </View>
              ) : null}
              <View style={styles.metaItem}>
                <Clock color={colors.textMuted} size={10} />
                <Text style={styles.metaText}>
                  {getSessionTimeAgo(item.time.updated, now)}
                </Text>
              </View>
              {totalChanges > 0 ? (
                <View style={styles.changeBadge}>
                  <Text style={styles.changeText}>
                    +{item.summary?.additions ?? 0}/ -
                    {item.summary?.deletions ?? 0}
                  </Text>
                </View>
              ) : null}
            </View>
            <View style={styles.activityRow}>
              {isRecent ? (
                <View
                  style={[
                    styles.activityDot,
                    { backgroundColor: colors.success },
                  ]}
                />
              ) : null}
              <Text style={styles.activityLabel}>
                Updated {formatSessionDate(item.time.updated)}
              </Text>
            </View>
          </Pressable>
        </View>
      </Swipeable>
    );
  };

  return (
    <Modal animationType="slide" transparent visible={visible}>
      <Pressable onPress={onClose} style={styles.backdrop}>
        <Pressable
          onPress={(event) => event.stopPropagation()}
          style={styles.sheet}
        >
          <View style={styles.header}>
            <Text style={styles.title}>Sessions</Text>
            <Pressable onPress={onClose}>
              <X color={colors.textMuted} size={20} />
            </Pressable>
          </View>

          <View style={styles.filterRow}>
            <Pressable
              onPress={() => setListFilter("active")}
              style={[
                styles.filterChip,
                listFilter === "active" ? styles.filterChipActive : null,
              ]}
            >
              <Text
                style={[
                  styles.filterChipText,
                  listFilter === "active" ? styles.filterChipTextActive : null,
                ]}
              >
                Active ({partitioned.active.length})
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setListFilter("archived")}
              style={[
                styles.filterChip,
                listFilter === "archived" ? styles.filterChipActive : null,
              ]}
            >
              <Text
                style={[
                  styles.filterChipText,
                  listFilter === "archived"
                    ? styles.filterChipTextActive
                    : null,
                ]}
              >
                Archived ({partitioned.archived.length})
              </Text>
            </Pressable>
          </View>

          <Pressable onPress={handleCreate} style={styles.createButton}>
            <Plus color={colors.accent} size={18} />
            <Text style={styles.createText}>New session</Text>
          </Pressable>

          {templates.length > 0 ? (
            <Pressable
              onPress={() => setShowTemplates((current) => !current)}
              style={styles.templateButton}
            >
              <Text style={styles.templateButtonText}>
                {showTemplates ? "Hide templates" : "New from template"}
              </Text>
            </Pressable>
          ) : null}

          {showTemplates
            ? templates.map((template) => (
                <Pressable
                  key={template.id}
                  onPress={() => void handleCreateFromTemplate(template)}
                  style={styles.templateItem}
                >
                  <Text style={styles.templateName}>{template.name}</Text>
                  <Text style={styles.templatePrompt} numberOfLines={2}>
                    {template.prompt}
                  </Text>
                </Pressable>
              ))
            : null}

          <View style={styles.searchContainer}>
            <Search color={colors.textMuted} size={16} />
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setSearchQuery}
              placeholder="Search sessions..."
              placeholderTextColor={colors.textMuted}
              style={styles.searchInput}
              value={searchQuery}
            />
            {searchQuery.length > 0 ? (
              <Pressable onPress={() => setSearchQuery("")}>
                <X color={colors.textMuted} size={16} />
              </Pressable>
            ) : null}
          </View>

          {isLoading ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <FlatList
              data={groupedSessions.flatMap((section) => [
                { type: "header" as const, section },
                ...section.sessions.map((session) => ({
                  type: "item" as const,
                  session,
                  section,
                })),
              ])}
              keyExtractor={(item) =>
                item.type === "header"
                  ? `header-${item.section.group}`
                  : item.session.id
              }
              refreshControl={
                <RefreshControl
                  colors={[colors.accent]}
                  onRefresh={() => void refetch()}
                  refreshing={isLoading}
                  tintColor={colors.accent}
                />
              }
              ListEmptyComponent={
                <Text style={styles.empty}>
                  {searchQuery
                    ? "No sessions match your search."
                    : listFilter === "archived"
                      ? "No archived sessions."
                      : "No sessions on this host yet."}
                </Text>
              }
              renderItem={({ item }) => {
                if (isHeaderItem(item)) {
                  return renderSectionHeader({ section: item.section });
                }
                const isExpanded = expandedGroups.has(item.section.group);
                if (!isExpanded) return null;
                return renderItem({ item: item.session });
              }}
            />
          )}
          <Snackbar
            message={snackbar.message}
            visible={snackbar.visible}
            action={snackbar.action}
            onDismiss={hideSnackbar}
            durationMs={6000}
          />
        </Pressable>
      </Pressable>

      <Modal
        animationType="fade"
        transparent
        visible={Boolean(actionSession)}
        onRequestClose={() => setActionSession(null)}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => setActionSession(null)}
        >
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={styles.actionSheet}
          >
            <Text style={styles.actionTitle} numberOfLines={1}>
              {actionSession?.title || "Session actions"}
            </Text>
            <Pressable
              style={styles.actionItem}
              onPress={() => runSessionAction("pin")}
            >
              <Pin color={colors.textMuted} size={18} />
              <Text style={styles.actionText}>
                {actionSession && isPinned(actionSession.id)
                  ? "Unpin"
                  : "Pin to top"}
              </Text>
            </Pressable>
            <Pressable
              style={styles.actionItem}
              onPress={() => runSessionAction("archive")}
            >
              <Archive color={colors.textMuted} size={18} />
              <Text style={styles.actionText}>
                {actionSession && isArchived(actionSession.id)
                  ? "Unarchive"
                  : "Archive"}
              </Text>
            </Pressable>
            <Pressable
              style={styles.actionItem}
              onPress={() => runSessionAction("export")}
            >
              <Share2 color={colors.textMuted} size={18} />
              <Text style={styles.actionText}>Export markdown</Text>
            </Pressable>
            <Pressable
              style={styles.actionItem}
              onPress={() => runSessionAction("delete")}
            >
              <Trash2 color={colors.danger} size={18} />
              <Text style={[styles.actionText, { color: colors.danger }]}>
                Delete
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </Modal>
  );
}
