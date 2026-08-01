import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Settings } from "lucide-react-native";
import { useCallback, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/context/ThemeContext";
import type { RootStackParamList } from "@/navigation/RootNavigator";

type Navigation = NativeStackNavigationProp<
  RootStackParamList,
  "ProviderPicker"
>;

export function ProviderPickerScreen() {
  const navigation = useNavigation<Navigation>();
  const { colors, spacing, typography } = useTheme();

  const handleOpenCode = useCallback(() => {
    navigation.navigate("Connection");
  }, [navigation]);

  const handleCursor = useCallback(() => {
    navigation.navigate("CursorConnection");
  }, [navigation]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: colors.background,
          padding: spacing.lg,
          justifyContent: "center",
        },
        title: {
          color: colors.text,
          fontSize: typography.title,
          fontWeight: "700",
          marginBottom: spacing.sm,
          textAlign: "center",
        },
        subtitle: {
          color: colors.textMuted,
          fontSize: typography.body,
          marginBottom: spacing.xl,
          textAlign: "center",
        },
        card: {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 16,
          padding: spacing.lg,
          marginBottom: spacing.md,
        },
        cardTitle: {
          color: colors.text,
          fontSize: typography.subtitle,
          fontWeight: "600",
          marginBottom: spacing.xs,
        },
        cardDescription: {
          color: colors.textMuted,
          fontSize: typography.caption,
          lineHeight: 20,
        },
        badge: {
          alignSelf: "flex-start",
          backgroundColor: colors.accentMuted,
          borderRadius: 8,
          paddingHorizontal: spacing.sm,
          paddingVertical: 4,
          marginBottom: spacing.sm,
        },
        badgeText: {
          color: colors.accent,
          fontSize: typography.caption,
          fontWeight: "600",
        },
        header: {
          flexDirection: "row",
          justifyContent: "flex-end",
          marginBottom: spacing.md,
        },
        settingsButton: {
          padding: spacing.sm,
        },
      }),
    [colors, spacing, typography],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.navigate("Settings")}
          style={styles.settingsButton}
          hitSlop={8}
        >
          <Settings color={colors.textMuted} size={22} />
        </Pressable>
      </View>

      <Text style={styles.title}>Desk Escape</Text>
      <Text style={styles.subtitle}>Choose your agent backend</Text>

      <Pressable onPress={handleOpenCode} style={styles.card}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>OpenCode</Text>
        </View>
        <Text style={styles.cardTitle}>Local OpenCode Server</Text>
        <Text style={styles.cardDescription}>
          Connect to a self-hosted OpenCode instance over Tailscale or
          myfritz.link. Supports terminal, file browser, and slash commands.
        </Text>
      </Pressable>

      <Pressable onPress={handleCursor} style={styles.card}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>Cursor</Text>
        </View>
        <Text style={styles.cardTitle}>Cursor Cloud Agents</Text>
        <Text style={styles.cardDescription}>
          Use Cursor Cloud Agents for AI-powered coding sessions with managed
          infrastructure. Supports agent-based workflows and run tracking.
        </Text>
      </Pressable>
    </View>
  );
}
