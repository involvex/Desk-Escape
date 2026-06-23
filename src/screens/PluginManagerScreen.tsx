import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChevronLeft, Plus, Trash2 } from "lucide-react-native";
import { useOpenCodeConfig, useUpdateConfig } from "@/api/hooks";
import { useTheme } from "@/context/ThemeContext";
import type { RootStackParamList } from "@/navigation/RootNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "Plugins">;

export function PluginManagerScreen({ navigation }: Props) {
  const { colors, spacing, typography } = useTheme();
  const { data: config, isLoading } = useOpenCodeConfig();
  const updateConfig = useUpdateConfig();
  const [newPlugin, setNewPlugin] = useState("");

  const plugins = config?.plugin ?? [];

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
        addRow: {
          alignItems: "center",
          flexDirection: "row",
          gap: spacing.sm,
          margin: spacing.md,
        },
        input: {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: 12,
          borderWidth: 1,
          color: colors.text,
          flex: 1,
          fontSize: typography.body,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
        },
        addButton: {
          alignItems: "center",
          backgroundColor: colors.accent,
          borderRadius: 12,
          height: 44,
          justifyContent: "center",
          width: 44,
        },
        item: {
          alignItems: "center",
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: 12,
          borderWidth: 1,
          flexDirection: "row",
          justifyContent: "space-between",
          marginBottom: spacing.sm,
          marginHorizontal: spacing.md,
          padding: spacing.md,
        },
        itemText: {
          color: colors.text,
          flex: 1,
          fontSize: typography.body,
        },
        hint: {
          color: colors.textMuted,
          fontSize: typography.caption,
          marginHorizontal: spacing.md,
          marginBottom: spacing.md,
        },
        empty: {
          color: colors.textMuted,
          fontSize: typography.body,
          padding: spacing.lg,
          textAlign: "center",
        },
      }),
    [colors, spacing, typography],
  );

  const savePlugins = (nextPlugins: string[]) => {
    if (!config) {
      return;
    }

    Alert.alert(
      "Update plugins?",
      "Server reload may be required after plugin changes.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Save",
          onPress: () => {
            void updateConfig.mutateAsync({
              ...config,
              plugin: nextPlugins,
            });
          },
        },
      ],
    );
  };

  const handleAdd = () => {
    const trimmed = newPlugin.trim();
    if (!trimmed || plugins.includes(trimmed)) {
      return;
    }
    setNewPlugin("");
    savePlugins([...plugins, trimmed]);
  };

  const handleRemove = (plugin: string) => {
    Alert.alert("Remove plugin?", plugin, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          savePlugins(plugins.filter((item) => item !== plugin));
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}>
          <ChevronLeft color={colors.text} size={22} />
        </Pressable>
        <Text style={styles.title}>Plugins</Text>
      </View>

      <Text style={styles.hint}>
        Installed plugins are read from OpenCode config. Add package names and
        save — there is no install RPC; restart the server if needed.
      </Text>

      <View style={styles.addRow}>
        <TextInput
          onChangeText={setNewPlugin}
          placeholder="npm package name"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          value={newPlugin}
        />
        <Pressable onPress={handleAdd} style={styles.addButton}>
          <Plus color="#04111A" size={20} />
        </Pressable>
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <FlatList
          data={plugins}
          keyExtractor={(item) => item}
          ListEmptyComponent={
            <Text style={styles.empty}>No plugins configured.</Text>
          }
          renderItem={({ item }) => (
            <View style={styles.item}>
              <Text style={styles.itemText}>{item}</Text>
              <Pressable onPress={() => handleRemove(item)}>
                <Trash2 color={colors.danger} size={18} />
              </Pressable>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}
