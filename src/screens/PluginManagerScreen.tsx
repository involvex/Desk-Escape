import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { PluginInfo } from "@opencode/client";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ChevronLeft,
  Download,
  Info,
  RefreshCw,
  Search,
  TriangleAlert,
} from "lucide-react-native";
import { useOpenCodeConfig } from "@/api/hooks";
import { configPluginNames } from "@/api/opencode/config";
import {
  pluginBadgeLabel,
  pluginErrorDetail,
  pluginErrorMessage,
  pluginFeatures,
  pluginHasFailed,
  pluginIsOutdated,
  pluginKey,
  pluginName,
  pluginSourceLabel,
  pluginUpdateTargets,
  usePluginCheck,
  usePluginUpdate,
  usePlugins,
} from "@/api/opencode/plugins";
import { useTheme } from "@/context/ThemeContext";
import type { RootStackParamList } from "@/navigation/RootNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "Plugins">;

/** One rendered line in the list, either loaded or config-declared only. */
interface PluginRow {
  key: string;
  name: string;
  source: string;
  /** Short state shown in the badge. */
  badge: string;
  /** Longer state line, e.g. a load failure message. */
  detail: string | null;
  failed: boolean;
  outdated: boolean;
  features: string[];
  /** `false` for packages the server did not report as loaded. */
  loaded: boolean;
}

/**
 * Coerce anything to a string safe to hand to `<Text>`.
 *
 * React throws `Objects are not valid as a React child` if a non-string child
 * reaches a `<Text>`. Plugin `options` are free-form server data — a plugin
 * configured as `{ package, options: { hostname: "0.0.0.0" } }` is a real shape
 * in `opencode.json` — so this is a live hazard rather than a theoretical one.
 * Never let a value through unverified.
 */
function asText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  // Loud on purpose: this should never fire, and if it does it identifies the
  // exact field and payload that reached a <Text>, which a silent fallback would
  // hide behind a wrong-looking row.
  if (__DEV__ && value != null) {
    console.warn(
      `[plugins] non-renderable value coerced to "${fallback}":`,
      value,
    );
  }
  return fallback;
}

function toRow(info: PluginInfo, index: number): PluginRow {
  return {
    key: asText(pluginKey(info, index), `plugin:${index}`),
    name: asText(pluginName(info), "unknown plugin"),
    source: asText(pluginSourceLabel(info), "unknown source"),
    badge: asText(pluginBadgeLabel(info), "unknown"),
    detail: pluginErrorDetail(info) ? asText(pluginErrorDetail(info)) : null,
    failed: pluginHasFailed(info),
    outdated: pluginIsOutdated(info),
    features: pluginFeatures(info).map((feature) => asText(feature)),
    loaded: true,
  };
}

/**
 * Installed plugins, read-only.
 *
 * V1 installed and removed plugins by writing `config.plugin`, so this screen
 * used to be a text field plus a delete button. **OpenCode V2 removed that write
 * path**: `config.update` patches only `shell`, and the plugin namespace offers
 * just `list`, `check` and `update`. There is no API call that adds or removes a
 * plugin, so this screen no longer offers one — it reports what the server
 * loaded, lets the user check for and apply newer package versions, and says
 * plainly that installing is not something this app can do.
 *
 * Everything below is derived from `plugin.list`, which is the only plugin data
 * V2 exposes. The list is cross-referenced against the resolved config's
 * `plugins` array so a package that is declared but not loaded is still visible
 * instead of silently missing.
 */
export function PluginManagerScreen({ navigation }: Props) {
  const { colors, spacing, typography } = useTheme();
  const { data: config } = useOpenCodeConfig();
  const listQuery = usePlugins();
  const check = usePluginCheck();
  const update = usePluginUpdate();
  const [notice, setNotice] = useState<string | null>(null);

  const declared = useMemo(() => configPluginNames(config), [config]);

  const plugins = useMemo(
    () => (listQuery.data ?? []) as PluginInfo[],
    [listQuery.data],
  );

  const rows = useMemo<PluginRow[]>(() => {
    const loaded = plugins.map((info, index) => toRow(info, index));
    const seen = new Set(loaded.map((row) => row.name));
    // Config-declared packages the server did not report. Surfacing these beats
    // hiding a plugin the user believes is installed. `asText` guards the case
    // where a config entry is an object rather than a package name.
    const missing = declared
      .map((name) => asText(name))
      .filter((name) => name.length > 0 && !seen.has(name))
      .map<PluginRow>((name) => ({
        key: `declared:${name}`,
        name,
        source: "declared in config",
        badge: "not loaded",
        detail: null,
        failed: false,
        outdated: false,
        features: [],
        loaded: false,
      }));
    return [...loaded, ...missing];
  }, [plugins, declared]);

  const outdatedTargets = useMemo(
    () => pluginUpdateTargets(plugins.filter(pluginIsOutdated)),
    [plugins],
  );
  const allTargets = useMemo(() => pluginUpdateTargets(plugins), [plugins]);

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
          paddingBottom: spacing.xl,
        },
        notice: {
          alignItems: "flex-start",
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: 12,
          borderWidth: 1,
          flexDirection: "row",
          gap: spacing.sm,
          margin: spacing.md,
          padding: spacing.md,
        },
        noticeText: {
          color: colors.textMuted,
          flex: 1,
          fontSize: typography.caption,
          lineHeight: typography.caption * 1.5,
        },
        noticeTitle: {
          color: colors.text,
          fontSize: typography.caption,
          fontWeight: "700",
          marginBottom: 2,
        },
        actions: {
          flexDirection: "row",
          gap: spacing.sm,
          marginHorizontal: spacing.md,
        },
        actionButton: {
          alignItems: "center",
          borderColor: colors.border,
          borderRadius: 12,
          borderWidth: 1,
          flex: 1,
          flexDirection: "row",
          gap: spacing.sm,
          justifyContent: "center",
          paddingVertical: spacing.md,
        },
        actionPrimary: {
          backgroundColor: colors.accent,
          borderColor: colors.accent,
        },
        actionDisabled: {
          opacity: 0.4,
        },
        actionText: {
          color: colors.text,
          fontSize: typography.body,
          fontWeight: "600",
        },
        actionTextPrimary: {
          color: "#04111A",
        },
        status: {
          fontSize: typography.caption,
          marginTop: spacing.md,
          paddingHorizontal: spacing.md,
        },
        error: {
          alignItems: "center",
          flexDirection: "row",
          gap: spacing.sm,
          marginHorizontal: spacing.md,
          marginTop: spacing.sm,
        },
        errorText: {
          color: colors.danger,
          flex: 1,
          fontSize: typography.caption,
        },
        linkButton: {
          color: colors.accent,
          fontSize: typography.caption,
          fontWeight: "600",
        },
        item: {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: 12,
          borderWidth: 1,
          marginBottom: spacing.sm,
          marginHorizontal: spacing.md,
          padding: spacing.md,
        },
        itemHeader: {
          alignItems: "center",
          flexDirection: "row",
          gap: spacing.sm,
          justifyContent: "space-between",
        },
        itemName: {
          color: colors.text,
          flex: 1,
          fontSize: typography.body,
          fontWeight: "600",
        },
        badge: {
          borderRadius: 999,
          borderWidth: 1,
          paddingHorizontal: spacing.sm,
          paddingVertical: 2,
        },
        badgeText: {
          fontSize: typography.caption,
          fontWeight: "700",
        },
        itemSource: {
          color: colors.textMuted,
          fontSize: typography.caption,
          marginTop: 2,
        },
        featureRow: {
          flexDirection: "row",
          flexWrap: "wrap",
          gap: spacing.sm,
          marginTop: spacing.sm,
        },
        feature: {
          backgroundColor: colors.surfaceElevated,
          borderRadius: 999,
          color: colors.textMuted,
          fontSize: typography.caption,
          paddingHorizontal: spacing.sm,
          paddingVertical: 2,
        },
        itemError: {
          color: colors.danger,
          fontSize: typography.caption,
          marginTop: spacing.sm,
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

  const refresh = useCallback(() => {
    setNotice(null);
    void listQuery.refetch();
  }, [listQuery]);

  const handleCheck = useCallback(() => {
    setNotice(null);
    check
      .mutateAsync()
      .then((result) => {
        const outdated = result.filter(pluginIsOutdated);
        setNotice(
          outdated.length === 0
            ? "All package plugins are up to date."
            : `${outdated.length} update${outdated.length === 1 ? "" : "s"} available.`,
        );
        void listQuery.refetch();
      })
      .catch((error: unknown) => setNotice(pluginErrorMessage(error)));
  }, [check, listQuery]);

  const handleUpdate = useCallback(
    (targets: string[]) => {
      if (targets.length === 0) {
        return;
      }
      setNotice(null);
      Alert.alert(
        "Update plugins?",
        `The server will reinstall ${targets.length} package${
          targets.length === 1 ? "" : "s"
        }. A reload may be required afterwards.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Update",
            onPress: () => {
              update
                .mutateAsync(targets)
                .then(() => setNotice("Update requested. Pull to refresh."))
                .catch((error: unknown) =>
                  setNotice(pluginErrorMessage(error)),
                );
            },
          },
        ],
      );
    },
    [update],
  );

  const busy = check.isPending || update.isPending;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}>
          <ChevronLeft color={colors.text} size={22} />
        </Pressable>
        <Text style={styles.title}>Plugins</Text>
        <Pressable onPress={refresh}>
          <RefreshCw color={colors.text} size={18} />
        </Pressable>
      </View>

      <View style={styles.notice}>
        <Info color={colors.textMuted} size={16} style={{ marginTop: 2 }} />
        <View style={{ flex: 1 }}>
          <Text style={styles.noticeTitle}>Read-only in OpenCode 2.x</Text>
          <Text style={styles.noticeText}>
            The V2 API can list, check and update plugins, but it cannot install
            or remove them — the plugin list is no longer writable. This screen
            shows what the server loaded. Change the plugin list through the
            OpenCode host, then pull down to refresh.
          </Text>
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable
          disabled={busy}
          onPress={handleCheck}
          style={[styles.actionButton, busy ? styles.actionDisabled : null]}
        >
          {check.isPending ? (
            <ActivityIndicator color={colors.text} size="small" />
          ) : (
            <Search size={16} color={colors.text} />
          )}
          <Text style={styles.actionText}>Check for updates</Text>
        </Pressable>
        <Pressable
          disabled={busy || allTargets.length === 0}
          onPress={() =>
            handleUpdate(
              outdatedTargets.length > 0 ? outdatedTargets : allTargets,
            )
          }
          style={[
            styles.actionButton,
            styles.actionPrimary,
            busy || allTargets.length === 0 ? styles.actionDisabled : null,
          ]}
        >
          {update.isPending ? (
            <ActivityIndicator color="#04111A" size="small" />
          ) : (
            <Download size={16} color="#04111A" />
          )}
          <Text style={[styles.actionText, styles.actionTextPrimary]}>
            Update
          </Text>
        </Pressable>
      </View>

      <Text
        style={[
          styles.status,
          { color: notice ? colors.accent : colors.textMuted },
        ]}
      >
        {notice ??
          `${rows.length} loaded${outdatedTargets.length > 0 ? ` · ${outdatedTargets.length} outdated` : ""}`}
      </Text>

      {listQuery.isError ? (
        <View style={styles.error}>
          <TriangleAlert color={colors.danger} size={16} />
          <Text style={styles.errorText}>
            {pluginErrorMessage(listQuery.error)}
          </Text>
          <Pressable onPress={refresh}>
            <Text style={styles.linkButton}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {listQuery.isLoading ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          contentContainerStyle={styles.content}
          data={rows}
          keyExtractor={(row) => row.key}
          refreshControl={
            <RefreshControl
              onRefresh={refresh}
              refreshing={listQuery.isRefetching}
              tintColor={colors.accent}
            />
          }
          ListEmptyComponent={
            <Text style={styles.empty}>
              No plugins loaded. This server exposes no way to install one from
              the app.
            </Text>
          }
          renderItem={({ item }) => (
            <View style={styles.item}>
              <View style={styles.itemHeader}>
                <Text numberOfLines={1} style={styles.itemName}>
                  {item.name}
                </Text>
                <View
                  style={[
                    styles.badge,
                    {
                      borderColor: item.failed
                        ? colors.danger
                        : item.outdated
                          ? colors.warning
                          : item.loaded
                            ? colors.success
                            : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.badgeText,
                      {
                        color: item.failed
                          ? colors.danger
                          : item.outdated
                            ? colors.warning
                            : item.loaded
                              ? colors.success
                              : colors.textMuted,
                      },
                    ]}
                  >
                    {item.badge}
                  </Text>
                </View>
              </View>
              <Text style={styles.itemSource}>{item.source}</Text>
              {item.detail ? (
                <Text style={styles.itemError}>{item.detail}</Text>
              ) : null}
              {item.features.length > 0 ? (
                <View style={styles.featureRow}>
                  {item.features.map((feature) => (
                    <Text key={feature} style={styles.feature}>
                      {feature}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}
