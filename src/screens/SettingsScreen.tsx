import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { useOpenCodeConfig, useUpdateConfig } from "@/api/hooks";
import { useOrientation } from "@/context/OrientationContext";
import { useTheme } from "@/context/ThemeContext";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import type { OrientationMode, ThemeName } from "@/types/opencode";

type Props = NativeStackScreenProps<RootStackParamList, "Settings">;

const themeOptions: { id: ThemeName; label: string }[] = [
  { id: "oled-black", label: "OLED Black" },
  { id: "dev-dark", label: "Dev Dark" },
  { id: "dev-light", label: "Dev Light" },
];

const orientationOptions: { id: OrientationMode; label: string }[] = [
  { id: "portrait", label: "Portrait only" },
  { id: "auto", label: "Auto-rotate" },
  { id: "landscape", label: "Landscape preferred" },
];

export function SettingsScreen({ navigation }: Props) {
  const { colors, spacing, typography, themeName, setThemeName } = useTheme();
  const { mode: orientationMode, setMode: setOrientationMode } =
    useOrientation();
  const { data: config, isLoading } = useOpenCodeConfig();
  const updateConfig = useUpdateConfig();
  const [jsonDraft, setJsonDraft] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        safeArea: {
          backgroundColor: colors.background,
          flex: 1,
        },
        header: {
          alignItems: "center",
          borderBottomColor: colors.border,
          borderBottomWidth: 1,
          flexDirection: "row",
          gap: spacing.sm,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
        },
        title: {
          color: colors.text,
          flex: 1,
          fontSize: typography.subtitle,
          fontWeight: "700",
        },
        content: {
          flex: 1,
          padding: spacing.md,
        },
        section: {
          marginBottom: spacing.lg,
        },
        sectionTitle: {
          color: colors.textMuted,
          fontSize: typography.caption,
          fontWeight: "700",
          letterSpacing: 0.6,
          marginBottom: spacing.sm,
          textTransform: "uppercase",
        },
        row: {
          alignItems: "center",
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: 12,
          borderWidth: 1,
          flexDirection: "row",
          justifyContent: "space-between",
          marginBottom: spacing.sm,
          padding: spacing.md,
        },
        rowLabel: {
          color: colors.text,
          fontSize: typography.body,
        },
        chipRow: {
          flexDirection: "row",
          flexWrap: "wrap",
          gap: spacing.sm,
        },
        chip: {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: 999,
          borderWidth: 1,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
        },
        chipActive: {
          borderColor: colors.accent,
          backgroundColor: colors.accentMuted,
        },
        chipText: {
          color: colors.text,
          fontSize: typography.caption,
          fontWeight: "600",
        },
        warning: {
          color: colors.warning,
          fontSize: typography.caption,
          marginBottom: spacing.sm,
        },
        jsonInput: {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: 12,
          borderWidth: 1,
          color: colors.text,
          fontFamily: "monospace",
          fontSize: typography.mono,
          minHeight: 200,
          padding: spacing.md,
          textAlignVertical: "top",
        },
        saveButton: {
          alignItems: "center",
          backgroundColor: colors.accent,
          borderRadius: 12,
          marginTop: spacing.md,
          padding: spacing.md,
        },
        saveText: {
          color: "#04111A",
          fontSize: typography.body,
          fontWeight: "700",
        },
        meta: {
          color: colors.textMuted,
          fontSize: typography.caption,
          marginTop: spacing.xs,
        },
      }),
    [colors, spacing, typography],
  );

  const handleOpenAdvanced = () => {
    if (config) {
      setJsonDraft(JSON.stringify(config, null, 2));
    }
    setShowAdvanced(true);
  };

  const handleSaveJson = () => {
    try {
      const parsed = JSON.parse(jsonDraft) as Record<string, unknown>;
      setJsonError(null);
      Alert.alert(
        "Update server config?",
        "This updates OpenCode globally on the connected host.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Save",
            style: "destructive",
            onPress: () => {
              void updateConfig.mutateAsync(
                parsed as Parameters<typeof updateConfig.mutateAsync>[0],
              );
            },
          },
        ],
      );
    } catch {
      setJsonError("Invalid JSON.");
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}>
          <ChevronLeft color={colors.text} size={22} />
        </Pressable>
        <Text style={styles.title}>Settings</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Appearance</Text>
            <View style={styles.chipRow}>
              {themeOptions.map((option) => (
                <Pressable
                  key={option.id}
                  onPress={() => setThemeName(option.id)}
                  style={[
                    styles.chip,
                    themeName === option.id ? styles.chipActive : null,
                  ]}
                >
                  <Text style={styles.chipText}>{option.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Orientation</Text>
            <View style={styles.chipRow}>
              {orientationOptions.map((option) => (
                <Pressable
                  key={option.id}
                  onPress={() => setOrientationMode(option.id)}
                  style={[
                    styles.chip,
                    orientationMode === option.id ? styles.chipActive : null,
                  ]}
                >
                  <Text style={styles.chipText}>{option.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Server config</Text>
            <Text style={styles.meta}>
              Agents: {Object.keys(config?.agent ?? {}).length} · Commands:{" "}
              {Object.keys(config?.command ?? {}).length} · Plugins:{" "}
              {(config?.plugin ?? []).length}
            </Text>
            <Pressable
              onPress={() => navigation.navigate("Plugins")}
              style={styles.row}
            >
              <Text style={styles.rowLabel}>Plugin manager</Text>
              <ChevronRight color={colors.textMuted} size={18} />
            </Pressable>
            <Pressable onPress={handleOpenAdvanced} style={styles.row}>
              <Text style={styles.rowLabel}>Advanced JSON editor</Text>
              <ChevronRight color={colors.textMuted} size={18} />
            </Pressable>
          </View>

          {showAdvanced ? (
            <View style={styles.section}>
              <Text style={styles.warning}>
                Changes apply to the OpenCode server globally. A reload may be
                required for plugins.
              </Text>
              <TextInput
                multiline
                onChangeText={setJsonDraft}
                style={styles.jsonInput}
                value={jsonDraft}
              />
              {jsonError ? (
                <Text style={styles.warning}>{jsonError}</Text>
              ) : null}
              <Pressable
                disabled={updateConfig.isPending}
                onPress={handleSaveJson}
                style={styles.saveButton}
              >
                <Text style={styles.saveText}>
                  {updateConfig.isPending ? "Saving..." : "Save config"}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
