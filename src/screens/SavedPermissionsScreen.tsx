import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useMemo } from "react";
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
import { ChevronLeft, ShieldOff, Trash2 } from "lucide-react-native";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OpenCodeClient } from "@opencode/client";
import {
  listSavedPermissions,
  removeSavedPermission,
  type PermissionSavedInfo,
} from "@/api/permissions";
import { toOpenCodeError } from "@/api/opencode/errors";
import { useCurrentProject } from "@/api/hooks";
import {
  describeGrant,
  formatGrantAge,
  needsConfirmation,
  savedPermissionsKey,
  toGrantViews,
  type GrantView,
} from "@/api/saved-permissions";
import { useConnection } from "@/context/ConnectionContext";
import { useTheme } from "@/context/ThemeContext";
import type { RootStackParamList } from "@/navigation/RootNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "SavedPermissions">;

/**
 * Review and revoke persisted "always allow" grants.
 *
 * Tapping "Always" on a permission banner writes a grant that outlives the
 * session, the app, and the app being reinstalled. Until this screen existed
 * `permission.saved.list` / `.remove` were implemented and called by nothing,
 * so a user who once tapped "Always" on a broad bash grant had no way to take it
 * back. The banner's own wording ("remembers this for the project") is a promise
 * the app needs to be able to keep and to withdraw.
 */
export function SavedPermissionsScreen({ navigation }: Props) {
  const { colors, spacing, typography } = useTheme();
  const { client: rawClient, activeDirectory } = useConnection();
  const client = rawClient as OpenCodeClient | null;
  const queryClient = useQueryClient();

  // `permission.saved.list` filters on a **project id**, not a directory.
  //
  // Verified against a live server (scripts/probe-server-contracts.mjs, Q2): a
  // `projectID` holding a filesystem path returns exactly the same empty set as a
  // random string, because the server keys grants on an opaque id -- `project.list`
  // reports that id and the path as two separate fields, `id` and `canonical`. The
  // screen used to pass `activeDirectory` straight through, so it did not fail
  // loudly: it returned no grants and rendered "No persistent grants" forever,
  // which is indistinguishable from a project that genuinely has none.
  //
  // So resolve the id first, the same way `StatsScreen` does, and refuse to render
  // a list that is not sourced from one.
  const project = useCurrentProject();
  const projectId = project.data?.id ?? null;

  const list = useQuery({
    enabled: Boolean(client) && projectId !== null,
    queryKey: savedPermissionsKey(activeDirectory),
    queryFn: async (): Promise<PermissionSavedInfo[]> => {
      if (!client || projectId === null) {
        throw new Error("Project not resolved.");
      }
      return listSavedPermissions(client, projectId);
    },
    staleTime: 30_000,
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!client) {
        throw new Error("Not connected.");
      }
      await removeSavedPermission(client, id);
    },
    // `remove` returns nothing, so the list has to be refetched rather than
    // patched locally. The row disappears only once the server confirms, which
    // is the point: an optimistic removal would hide a grant still in force.
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: savedPermissionsKey(activeDirectory),
      });
    },
  });

  const grants = useMemo(() => toGrantViews(list.data ?? []), [list.data]);

  const revoke = useCallback(
    (grant: GrantView) => {
      if (revokeMutation.isPending) return;

      if (needsConfirmation(grant)) {
        // A wildcard covered everything under its action without asking again.
        // Revoking it will re-prompt, possibly many times, so say so first.
        Alert.alert(
          "Revoke this grant?",
          `The agent will ask again before any ${grant.action} command. Previously-allowed commands will be prompted for once more.`,
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Revoke",
              style: "destructive",
              onPress: () => revokeMutation.mutate(grant.id),
            },
          ],
        );
        return;
      }

      revokeMutation.mutate(grant.id);
    },
    [revokeMutation],
  );

  const error = list.error ?? revokeMutation.error;
  const errorMessage = error ? toOpenCodeError(error).message : null;

  /**
   * True when the list is empty *because it was never sourced*.
   *
   * Gating the query on a resolved project id means an unresolved project leaves
   * `data` undefined, which is indistinguishable from a genuinely empty list.
   * Rendering "No persistent grants" in that state would repeat the exact bug
   * this screen was fixed for: a confident claim about grants it never asked for.
   * So an unresolved project gets its own message, as `StatsScreen` does.
   */
  const unsourced = projectId === null;

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
        content: { paddingBottom: spacing.xl },
        intro: {
          color: colors.textMuted,
          fontSize: typography.caption,
          paddingHorizontal: spacing.md,
          paddingTop: spacing.md,
        },
        row: {
          alignItems: "center",
          borderBottomColor: colors.border,
          borderBottomWidth: 1,
          flexDirection: "row",
          gap: spacing.md,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.md,
        },
        rowBody: { flex: 1, gap: 2 },
        grantLabel: {
          color: colors.text,
          fontSize: typography.body,
          fontWeight: "600",
        },
        grantMeta: { color: colors.textMuted, fontSize: typography.caption },
        grantScope: { color: colors.textMuted, fontSize: typography.caption },
        revoke: {
          alignItems: "center",
          borderColor: colors.danger,
          borderRadius: 999,
          borderWidth: 1,
          flexDirection: "row",
          gap: spacing.xs,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.xs,
        },
        revokeText: {
          color: colors.danger,
          fontSize: typography.caption,
          fontWeight: "600",
        },
        empty: {
          alignItems: "center",
          gap: spacing.sm,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.xl,
        },
        emptyText: {
          color: colors.textMuted,
          fontSize: typography.caption,
          textAlign: "center",
        },
        error: {
          color: colors.danger,
          fontSize: typography.caption,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
        },
        centered: {
          alignItems: "center",
          flex: 1,
          justifyContent: "center",
        },
      }),
    [colors, spacing, typography],
  );

  // `fetchStatus`, not `isPending`, decides this. A query that is `enabled: false`
  // stays pending forever, so gating on `isPending` alone meant the screen could
  // spin indefinitely with no client and never reach the empty list — there was no
  // fetch in flight to wait for. An unresolved project is the other way to have
  // nothing fetched, and it reaches the empty state too rather than spinning.
  if (list.isPending && list.fetchStatus !== "idle") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

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
        <Text style={styles.title}>Persistent grants</Text>
      </View>

      <FlatList
        contentContainerStyle={styles.content}
        data={grants}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            onRefresh={() => void list.refetch()}
            refreshing={list.isRefetching}
            tintColor={colors.textMuted}
          />
        }
        ListHeaderComponent={
          <View>
            <Text style={styles.intro}>
              Grants you have answered with &quot;Always&quot;. The agent will
              not ask again for these until you revoke them.
            </Text>
            {errorMessage ? (
              <Text style={styles.error}>{errorMessage}</Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          grants.length === 0 ? (
            <View style={styles.empty}>
              <ShieldOff color={colors.textMuted} size={28} />
              <Text style={styles.emptyText}>
                {unsourced
                  ? "Resolving which project's grants to show…"
                  : 'No persistent grants. Answering a permission request with "Always" adds one here.'}
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.rowBody}>
              <Text style={styles.grantLabel}>{describeGrant(item)}</Text>
              <Text style={styles.grantMeta}>
                Granted {formatGrantAge(item.updatedAt)}
                {item.project ? ` · ${item.project}` : ""}
              </Text>
              {item.wildcard ? (
                <Text style={styles.grantScope}>
                  Covers every {item.action} request, not one command.
                </Text>
              ) : null}
            </View>
            <Pressable
              accessibilityLabel={`Revoke ${describeGrant(item)}`}
              disabled={revokeMutation.isPending}
              onPress={() => revoke(item)}
              style={styles.revoke}
            >
              <Trash2 color={colors.danger} size={14} />
              <Text style={styles.revokeText}>
                {revokeMutation.isPending ? "…" : "Revoke"}
              </Text>
            </Pressable>
          </View>
        )}
      />
    </SafeAreaView>
  );
}
