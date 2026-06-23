import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Check, Lock, Save, Server, Wifi, X } from "lucide-react-native";
import { buildConnectionConfig, configToTargetUrl } from "@/api/client";
import {
  loadConnectionDraft,
  loadStoredConnectionConfig,
  readStoredPassword,
  saveConnectionDraft,
  useConnection,
} from "@/context/ConnectionContext";
import { useTheme } from "@/context/ThemeContext";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import type { ConnectionDraft, TestConnectionStatus } from "@/types/opencode";

type Navigation = NativeStackNavigationProp<RootStackParamList, "Connection">;

export function ConnectionScreen() {
  const navigation = useNavigation<Navigation>();
  const { colors, spacing, typography } = useTheme();
  const { connect, testServerConnection, recentHosts, errorMessage } =
    useConnection();

  const [target, setTarget] = useState("http://localhost:4096");
  const [useAuth, setUseAuth] = useState(false);
  const [username, setUsername] = useState("opencode");
  const [password, setPassword] = useState("");
  const [testStatus, setTestStatus] = useState<TestConnectionStatus>("idle");
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const draftPayload = useMemo(
    (): ConnectionDraft => ({
      target,
      useAuth,
      username,
    }),
    [target, useAuth, username],
  );

  useEffect(() => {
    void (async () => {
      const draft = await loadConnectionDraft();
      if (draft) {
        setTarget(draft.target);
        setUseAuth(draft.useAuth);
        setUsername(draft.username);
        if (draft.useAuth) {
          const storedPassword = await readStoredPassword(
            buildConnectionConfig(draft.target, {
              username: draft.username,
              useAuth: draft.useAuth,
            }).baseUrl,
          );
          if (storedPassword) {
            setPassword(storedPassword);
          }
        }
        return;
      }

      const stored = await loadStoredConnectionConfig();
      if (stored) {
        setTarget(configToTargetUrl(stored));
        setUseAuth(stored.useAuth);
        setUsername(stored.username);
        if (stored.useAuth) {
          const storedPassword = await readStoredPassword(stored.baseUrl);
          if (storedPassword) {
            setPassword(storedPassword);
          }
        }
        return;
      }

      if (recentHosts[0]) {
        setTarget(recentHosts[0].baseUrl);
        setUseAuth(recentHosts[0].useAuth);
        setUsername(recentHosts[0].username);
      }
    })();
  }, [recentHosts]);

  const persistDraft = useCallback(
    async (showFeedback = false) => {
      await saveConnectionDraft(draftPayload);
      if (showFeedback) {
        setSaveMessage("Connection settings saved.");
        setTimeout(() => setSaveMessage(null), 2000);
      }
    },
    [draftPayload],
  );

  useEffect(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
    }

    saveTimer.current = setTimeout(() => {
      void persistDraft();
    }, 600);

    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
    };
  }, [persistDraft]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: colors.background,
          padding: spacing.lg,
        },
        title: {
          color: colors.text,
          fontSize: typography.title,
          fontWeight: "700",
          marginBottom: spacing.xs,
        },
        subtitle: {
          color: colors.textMuted,
          fontSize: typography.body,
          marginBottom: spacing.lg,
        },
        label: {
          color: colors.textMuted,
          fontSize: typography.caption,
          marginBottom: spacing.xs,
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
        row: {
          alignItems: "center",
          flexDirection: "row",
          justifyContent: "space-between",
          marginBottom: spacing.md,
        },
        rowLabel: {
          color: colors.text,
          fontSize: typography.body,
        },
        button: {
          alignItems: "center",
          backgroundColor: colors.accent,
          borderRadius: 12,
          flexDirection: "row",
          gap: spacing.sm,
          justifyContent: "center",
          paddingVertical: spacing.md,
        },
        buttonSecondary: {
          backgroundColor: colors.surfaceElevated,
          borderColor: colors.border,
          borderWidth: 1,
          marginTop: spacing.sm,
        },
        buttonText: {
          color: "#04111A",
          fontSize: typography.body,
          fontWeight: "600",
        },
        buttonSecondaryText: {
          color: colors.text,
        },
        statusCard: {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: 12,
          borderWidth: 1,
          marginBottom: spacing.md,
          padding: spacing.md,
        },
        statusText: {
          color: colors.text,
          fontSize: typography.body,
        },
        recentTitle: {
          color: colors.text,
          fontSize: typography.subtitle,
          fontWeight: "600",
          marginBottom: spacing.sm,
          marginTop: spacing.lg,
        },
        recentItem: {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: 12,
          borderWidth: 1,
          marginBottom: spacing.sm,
          padding: spacing.md,
        },
        recentHost: {
          color: colors.text,
          fontSize: typography.body,
          fontWeight: "600",
        },
        recentMeta: {
          color: colors.textMuted,
          fontSize: typography.caption,
          marginTop: spacing.xs,
        },
        errorText: {
          color: colors.danger,
          fontSize: typography.caption,
          marginBottom: spacing.md,
        },
        savedText: {
          color: colors.success,
          fontSize: typography.caption,
          marginBottom: spacing.md,
        },
      }),
    [colors, spacing, typography],
  );

  const buildConfig = useCallback(() => {
    return buildConnectionConfig(target, {
      username,
      useAuth,
    });
  }, [target, username, useAuth]);

  const handleTest = useCallback(async () => {
    setTestStatus("testing");
    setTestMessage(null);

    try {
      const config = buildConfig();
      const result = await testServerConnection(config, password);
      if (result.healthy) {
        setTestStatus("success");
        setTestMessage(
          result.version
            ? `Connected. Server version ${result.version}.`
            : "Connection test succeeded.",
        );
      } else {
        setTestStatus("error");
        setTestMessage("Server responded but did not report healthy.");
      }
    } catch (error) {
      setTestStatus("error");
      setTestMessage(
        error instanceof Error ? error.message : "Connection test failed.",
      );
    }
  }, [buildConfig, password, testServerConnection]);

  const handleConnect = useCallback(async () => {
    setIsConnecting(true);
    try {
      const config = buildConfig();
      await connect(config, password);
      await persistDraft();
      navigation.replace("Workspace");
    } catch {
      // Error state is handled in context.
    } finally {
      setIsConnecting(false);
    }
  }, [buildConfig, connect, navigation, password, persistDraft]);

  const handleRecentPress = useCallback(
    async (baseUrl: string) => {
      setTarget(baseUrl);
      const storedPassword = await readStoredPassword(baseUrl);
      if (storedPassword) {
        setUseAuth(true);
        setPassword(storedPassword);
      }
      await saveConnectionDraft({
        target: baseUrl,
        useAuth: Boolean(storedPassword),
        username,
      });
    },
    [username],
  );

  const statusIcon = useMemo(() => {
    switch (testStatus) {
      case "testing":
        return <ActivityIndicator color={colors.accent} />;
      case "success":
        return <Check color={colors.success} size={18} />;
      case "error":
        return <X color={colors.danger} size={18} />;
      default:
        return <Wifi color={colors.textMuted} size={18} />;
    }
  }, [colors, testStatus]);

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Desk Escape</Text>
      <Text style={styles.subtitle}>
        Connect to your OpenCode host over Tailscale or myfritz.link.
      </Text>

      <Text style={styles.label}>OpenCode backend address</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        onChangeText={setTarget}
        placeholder="http://100.x.x.x:4096"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        value={target}
      />

      <View style={styles.row}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Lock color={colors.textMuted} size={16} />
          <Text style={styles.rowLabel}>Use secure credentials</Text>
        </View>
        <Switch
          onValueChange={setUseAuth}
          thumbColor={colors.text}
          trackColor={{ false: colors.border, true: colors.accentMuted }}
          value={useAuth}
        />
      </View>

      {useAuth ? (
        <>
          <Text style={styles.label}>Username</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setUsername}
            placeholder="opencode"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            value={username}
          />
          <Text style={styles.label}>Password</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setPassword}
            placeholder="OPENCODE_SERVER_PASSWORD"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            style={styles.input}
            value={password}
          />
        </>
      ) : null}

      <View style={styles.statusCard}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {statusIcon}
          <Text style={styles.statusText}>
            {testMessage ?? "Run a connection test before connecting."}
          </Text>
        </View>
      </View>

      {saveMessage ? <Text style={styles.savedText}>{saveMessage}</Text> : null}

      {errorMessage ? (
        <Text style={styles.errorText}>{errorMessage}</Text>
      ) : null}

      <Pressable onPress={() => void handleTest()} style={styles.button}>
        <Server color="#04111A" size={18} />
        <Text style={styles.buttonText}>Test Connection</Text>
      </Pressable>

      <Pressable
        onPress={() => void persistDraft(true)}
        style={[styles.button, styles.buttonSecondary]}
      >
        <Save color={colors.text} size={18} />
        <Text style={[styles.buttonText, styles.buttonSecondaryText]}>
          Save
        </Text>
      </Pressable>

      <Pressable
        disabled={isConnecting}
        onPress={() => void handleConnect()}
        style={[styles.button, styles.buttonSecondary]}
      >
        {isConnecting ? (
          <ActivityIndicator color={colors.text} />
        ) : (
          <Text style={[styles.buttonText, styles.buttonSecondaryText]}>
            Connect
          </Text>
        )}
      </Pressable>

      {recentHosts.length > 0 ? (
        <>
          <Text style={styles.recentTitle}>Recent hosts</Text>
          {recentHosts.map((host) => (
            <Pressable
              key={host.baseUrl}
              onPress={() => void handleRecentPress(host.baseUrl)}
              style={styles.recentItem}
            >
              <Text style={styles.recentHost}>{host.label}</Text>
              <Text style={styles.recentMeta}>{host.baseUrl}</Text>
            </Pressable>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}
