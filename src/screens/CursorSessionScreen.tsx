import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  ActivityIndicator,
} from "react-native";
import { Plus } from "lucide-react-native";
import { useTheme } from "@/context/ThemeContext";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useConnection } from "@/context/ConnectionContext";
import {
  useCursorSessions,
  useCursorSelectSession,
  useCursorCreateSession,
} from "@/api/providers/cursor/hooks";
import type { ProviderSession } from "@/api/providers/types";
import type { CursorProvider } from "@/api/providers/cursor/provider";

type Navigation = NativeStackNavigationProp<
  RootStackParamList,
  "CursorSessions"
>;

export function CursorSessionScreen() {
  const navigation = useNavigation<Navigation>();
  const { colors, spacing, typography } = useTheme();
  const { providerType, provider } = useConnection();
  const cursorProvider =
    providerType === "cursor" ? (provider as CursorProvider | null) : null;

  const fetchAgentList = useCursorSessions(cursorProvider);
  const selectAgent = useCursorSelectSession(cursorProvider);
  const createAgent = useCursorCreateSession(cursorProvider);

  const [sessions, setSessions] = useState<ProviderSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchAgentList();
      setSessions(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load agents.");
    } finally {
      setLoading(false);
    }
  }, [fetchAgentList]);

  useEffect(() => {
    if (providerType === "cursor") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch is safe
      void fetchSessions();
    }
  }, [providerType, fetchSessions]);

  const handleSelect = useCallback(
    async (session: ProviderSession) => {
      try {
        await selectAgent(session.id);
        navigation.replace("Workspace");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to select agent.");
      }
    },
    [selectAgent, navigation],
  );

  const handleCreate = useCallback(async () => {
    if (!titleDraft.trim()) return;
    try {
      await createAgent(titleDraft.trim());
      setShowCreate(false);
      setTitleDraft("");
      await fetchSessions();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create agent.");
    }
  }, [titleDraft, createAgent, fetchSessions]);

  const backNavigation = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: colors.background,
          padding: spacing.lg,
        },
        backButton: {
          marginBottom: spacing.md,
        },
        backText: {
          color: colors.accent,
          fontSize: typography.body,
        },
        header: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: spacing.lg,
        },
        title: {
          color: colors.text,
          fontSize: typography.title,
          fontWeight: "700",
        },
        card: {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 12,
          padding: spacing.md,
          marginBottom: spacing.sm,
        },
        cardTitle: {
          color: colors.text,
          fontSize: typography.body,
          fontWeight: "600",
        },
        cardMeta: {
          color: colors.textMuted,
          fontSize: typography.caption,
          marginTop: 4,
        },
        button: {
          backgroundColor: colors.accent,
          borderRadius: 12,
          paddingVertical: spacing.sm,
          paddingHorizontal: spacing.md,
          alignItems: "center",
        },
        buttonText: {
          color: "#04111A",
          fontSize: typography.body,
          fontWeight: "600",
        },
        input: {
          backgroundColor: colors.inputBackground,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 12,
          color: colors.text,
          fontSize: typography.body,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          marginBottom: spacing.md,
        },
        errorText: {
          color: colors.danger,
          fontSize: typography.caption,
          marginBottom: spacing.md,
        },
        emptyText: {
          color: colors.textMuted,
          fontSize: typography.body,
          textAlign: "center",
          marginTop: 24,
        },
      }),
    [colors, spacing, typography],
  );

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Pressable onPress={backNavigation} style={styles.backButton}>
        <Text style={styles.backText}>← Back</Text>
      </Pressable>

      <View style={styles.header}>
        <Text style={styles.title}>Cursor Agents</Text>
        <Pressable onPress={() => setShowCreate(true)} style={styles.button}>
          <Plus color="#04111A" size={16} />
          <Text style={styles.buttonText}>New</Text>
        </Pressable>
      </View>

      {showCreate ? (
        <View style={{ marginBottom: spacing.md }}>
          <TextInput
            autoCapitalize="none"
            placeholder="Agent name"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            value={titleDraft}
            onChangeText={setTitleDraft}
          />
          <Pressable onPress={handleCreate} style={styles.button}>
            <Text style={styles.buttonText}>Create</Text>
          </Pressable>
        </View>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {loading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : null}

      {!loading && !error && sessions.length === 0 && !showCreate ? (
        <Text style={styles.emptyText}>
          No agents yet. Create your first agent.
        </Text>
      ) : null}

      {!loading && !error
        ? sessions.map((session) => (
            <Pressable
              key={session.id}
              onPress={() => void handleSelect(session)}
              style={styles.card}
            >
              <Text style={styles.cardTitle}>{session.title}</Text>
              <Text style={styles.cardMeta}>
                {session.status} · {session.updatedAt ?? ""}
              </Text>
            </Pressable>
          ))
        : null}
    </ScrollView>
  );
}
