import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import type { OpenCodeClient, SessionStatsInfo } from "@opencode/client";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChevronLeft } from "lucide-react-native";

import { toOpenCodeError } from "@/api/opencode/errors";
import { useCurrentProject } from "@/api/hooks";
import {
  activityBars,
  isEmptyStats,
  modelShares,
  statTiles,
  statsRangeBounds,
  tokenBreakdown,
  STATS_RANGES,
  type StatsRange,
} from "@/api/session-stats";
import { useConnection } from "@/context/ConnectionContext";
import { useTheme } from "@/context/ThemeContext";
import type { RootStackParamList } from "@/navigation/RootNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "Stats">;

export const statsKey = (projectId: string, range: StatsRange) =>
  ["stats", projectId, range] as const;

/**
 * Token & cost dashboard.
 *
 * ## Why this screen refuses to guess its scope
 *
 * `session.stats` scopes by **project** and takes no `location` field, unlike
 * most endpoints in this API. That makes the project id load-bearing: without
 * it the server may report every project it knows about, and a usage figure that
 * silently aggregates other repositories is worse than no figure. So the screen
 * shows a resolving state until `useCurrentProject` has an id, and labels every
 * figure with the project it belongs to.
 */
export function StatsScreen({ navigation }: Props) {
  const { colors, spacing, typography } = useTheme();
  const { client: rawClient } = useConnection();
  const client = rawClient as OpenCodeClient | null;
  const { data: project } = useCurrentProject();
  const [range, setRange] = useState<StatsRange>("7d");

  const projectId = project?.id ?? null;

  const stats = useQuery({
    // Gated on the project id, not merely on the client: an unsourced total is
    // the one thing this screen must never render.
    enabled: Boolean(client) && projectId !== null,
    queryKey: statsKey(projectId ?? "unresolved", range),
    queryFn: async (): Promise<SessionStatsInfo> => {
      if (!client || !projectId) {
        throw new Error("Project not resolved.");
      }
      // `tools: "summary"` rather than `"detail"`: the dashboard shows tool
      // totals, and per-tool rows are a large response to carry over a phone
      // connection for something this screen does not display.
      return client.session.stats({
        ...statsRangeBounds(range),
        project: projectId,
        tools: "summary",
      });
    },
    staleTime: 60_000,
  });

  const styles = useMemo(
    () =>
      StyleSheet.create({
        safeArea: { backgroundColor: colors.background, flex: 1 },
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
          gap: spacing.lg,
          padding: spacing.md,
          paddingBottom: spacing.xl,
        },
        scope: { color: colors.textMuted, fontSize: typography.caption },
        sectionTitle: {
          color: colors.text,
          fontSize: typography.body,
          fontWeight: "700",
        },
        section: { gap: spacing.xs },
        rangeRow: { flexDirection: "row", gap: spacing.xs },
        rangeChip: {
          borderColor: colors.border,
          borderRadius: 999,
          borderWidth: 1,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.xs,
        },
        rangeChipActive: {
          backgroundColor: colors.accentMuted,
          borderColor: colors.accent,
        },
        rangeText: { color: colors.text, fontSize: typography.caption },
        tiles: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
        tile: {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: 12,
          borderWidth: 1,
          flexGrow: 1,
          gap: 2,
          minWidth: 140,
          padding: spacing.md,
        },
        tileValue: {
          color: colors.text,
          fontSize: typography.title,
          fontWeight: "700",
        },
        tileLabel: { color: colors.textMuted, fontSize: typography.caption },
        row: {
          flexDirection: "row",
          justifyContent: "space-between",
          paddingVertical: spacing.xs,
        },
        rowLabel: { color: colors.text, flex: 1, fontSize: typography.caption },
        rowValue: { color: colors.textMuted, fontSize: typography.caption },
        barTrack: {
          backgroundColor: colors.surface,
          borderRadius: 3,
          height: 6,
          overflow: "hidden",
        },
        barFill: { backgroundColor: colors.accent, height: 6 },
        empty: {
          alignItems: "center",
          gap: spacing.sm,
          paddingVertical: spacing.xl,
        },
        emptyText: {
          color: colors.textMuted,
          fontSize: typography.caption,
          textAlign: "center",
        },
        error: { color: colors.danger, fontSize: typography.caption },
        centered: { alignItems: "center", flex: 1, justifyContent: "center" },
      }),
    [colors, spacing, typography],
  );

  const body = (() => {
    if (projectId === null) {
      return (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            Resolving which project these figures belong to…
          </Text>
        </View>
      );
    }

    if (stats.isPending) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
        </View>
      );
    }

    const error = stats.error ? toOpenCodeError(stats.error).message : null;
    if (error) {
      return <Text style={styles.error}>{error}</Text>;
    }

    const data = stats.data;
    if (!data) {
      return null;
    }

    if (isEmptyStats(data)) {
      return (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            No usage recorded for this project in this window.
          </Text>
        </View>
      );
    }

    const bars = activityBars(data);
    const shares = modelShares(data);
    const tokens = tokenBreakdown(data.tokens);

    return (
      <>
        {/* Every figure below belongs to one project, and the API scopes by
            project. Saying so on the screen is the whole point. */}
        <Text style={styles.scope}>Project: {projectId}</Text>

        <View style={styles.rangeRow}>
          {STATS_RANGES.map((option) => (
            <Pressable
              key={option}
              onPress={() => setRange(option)}
              style={[
                styles.rangeChip,
                range === option ? styles.rangeChipActive : null,
              ]}
            >
              <Text style={styles.rangeText}>{option}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.tiles}>
          {statTiles(data).map((tile) => (
            <View key={tile.key} style={styles.tile}>
              <Text style={styles.tileValue}>{tile.value}</Text>
              <Text style={styles.tileLabel}>{tile.label}</Text>
            </View>
          ))}
        </View>

        {bars.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Activity</Text>
            {bars.map((bar) => (
              <View key={bar.date} style={styles.row}>
                <Text style={styles.rowLabel}>{bar.date}</Text>
                <View
                  style={[
                    styles.barTrack,
                    { flex: 1, marginHorizontal: spacing.sm },
                  ]}
                >
                  <View
                    style={[
                      styles.barFill,
                      { width: `${Math.round(bar.intensity * 100)}%` },
                    ]}
                  />
                </View>
                <Text style={styles.rowValue}>{bar.steps}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Tokens</Text>
          {/* Deliberately five separate figures and no total: cache reads are
              billed at a fraction of a normal input token, so summing them would
              overstate usage by an order of magnitude on a cache-heavy session. */}
          {tokens.map((row) => (
            <View key={row.key} style={styles.row}>
              <Text style={styles.rowLabel}>{row.label}</Text>
              <Text style={styles.rowValue}>{row.display}</Text>
            </View>
          ))}
        </View>

        {shares.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>By model</Text>
            {shares.map((share) => (
              <View key={share.key} style={styles.row}>
                <Text style={styles.rowLabel}>{share.label}</Text>
                <Text style={styles.rowValue}>
                  {share.percent}% · {share.steps} steps
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </>
    );
  })();

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Back"
          hitSlop={12}
          onPress={() => navigation.goBack()}
        >
          <ChevronLeft color={colors.text} size={24} />
        </Pressable>
        <Text style={styles.title}>Usage &amp; cost</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            onRefresh={() => void stats.refetch()}
            refreshing={stats.isRefetching}
            tintColor={colors.textMuted}
          />
        }
      >
        {body}
      </ScrollView>
    </SafeAreaView>
  );
}
