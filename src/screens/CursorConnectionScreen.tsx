import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Check, Globe, X } from "lucide-react-native";
import { useTheme } from "@/context/ThemeContext";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import type { CursorConnectionConfig } from "@/api/providers/types";
import { useCursorTestConnection } from "@/api/providers/cursor/hooks";
import { useConnection } from "@/context/ConnectionContext";

type Navigation = NativeStackNavigationProp<
  RootStackParamList,
  "CursorConnection"
>;

const DEFAULT_MODEL = "cursor";

export function CursorConnectionScreen() {
  const navigation = useNavigation<Navigation>();
  const { colors, spacing, typography } = useTheme();
  const { connect } = useConnection();

  const [apiKey, setApiKey] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [model, setModel] = useState(DEFAULT_MODEL);

  const config = useMemo(
    (): CursorConnectionConfig => ({
      type: "cursor",
      apiKey,
      repoUrl,
      branch,
      model,
    }),
    [apiKey, repoUrl, branch, model],
  );

  const testConnection = useCursorTestConnection(config);

  const [testStatus, setTestStatus] = useState<
    "idle" | "testing" | "success" | "error"
  >("idle");
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const handleTest = useCallback(async () => {
    setTestStatus("testing");
    setTestMessage(null);
    try {
      const result = await testConnection(apiKey);
      if (result.healthy) {
        setTestStatus("success");
        setTestMessage("Connected to Cursor Cloud Agents.");
      } else {
        setTestStatus("error");
        setTestMessage("Connection test failed.");
      }
    } catch (error) {
      setTestStatus("error");
      setTestMessage(
        error instanceof Error ? error.message : "Connection test failed.",
      );
    }
  }, [apiKey, testConnection]);

  const handleConnect = useCallback(async () => {
    if (!apiKey || !repoUrl) {
      setTestStatus("error");
      setTestMessage("API key and repo URL are required.");
      return;
    }
    setIsConnecting(true);
    setTestMessage(null);
    try {
      await connect(config, apiKey);
      navigation.replace("CursorSessions");
    } catch (error) {
      setTestStatus("error");
      setTestMessage(
        error instanceof Error ? error.message : "Connection failed.",
      );
    } finally {
      setIsConnecting(false);
    }
  }, [apiKey, repoUrl, config, connect, navigation]);

  const statusIcon = useMemo(() => {
    switch (testStatus) {
      case "testing":
        return <ActivityIndicator color={colors.accent} />;
      case "success":
        return <Check color={colors.success} size={18} />;
      case "error":
        return <X color={colors.danger} size={18} />;
      default:
        return <Globe color={colors.textMuted} size={18} />;
    }
  }, [colors, testStatus]);

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
        errorText: {
          color: colors.danger,
          fontSize: typography.caption,
          marginBottom: spacing.md,
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
      }),
    [colors, spacing, typography],
  );

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Cursor Cloud Agents</Text>
      <Text style={styles.subtitle}>
        Connect using your Cursor API key and repository details.
      </Text>

      <Text style={styles.label}>API Key</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setApiKey}
        placeholder="cursor_api_key"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        value={apiKey}
      />

      <Text style={styles.label}>Repository URL</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        onChangeText={setRepoUrl}
        placeholder="https://github.com/org/repo"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        value={repoUrl}
      />

      <Text style={styles.label}>Branch</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setBranch}
        placeholder="main"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        value={branch}
      />

      <Text style={styles.label}>Model</Text>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setModel}
        placeholder="cursor"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        value={model}
      />

      <View style={styles.statusCard}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {statusIcon}
          <Text style={styles.statusText}>
            {testMessage ?? "Run a connection test before connecting."}
          </Text>
        </View>
      </View>

      {testStatus === "error" && testMessage ? (
        <Text style={styles.errorText}>{testMessage}</Text>
      ) : null}

      <Pressable onPress={() => void handleTest()} style={styles.button}>
        <Globe color="#04111A" size={18} />
        <Text style={styles.buttonText}>Test Connection</Text>
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
    </ScrollView>
  );
}
