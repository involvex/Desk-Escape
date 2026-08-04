// TerminalPanel.tsx - Fixed version with proper error handling and authentication support
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { useCurrentProject } from "@/api/hooks";
import { usePtySession } from "@/api/use-pty-session";
import { TERMINAL_SHELL_HTML } from "@/assets/terminal-shell-html";
import { useConnection } from "@/context/ConnectionContext";
import { usePreferences } from "@/context/PreferencesContext";
import { useTheme } from "@/context/ThemeContext";
import { buildTerminalWebSocketUrl } from "@/utils/terminal-websocket";

interface TerminalPanelProps {
  bottomInset?: number;
}

interface TerminalWebViewMessage {
  type: "resize" | "connected" | "disconnected" | "error";
  cols?: number;
  rows?: number;
  code?: number;
  message?: string;
}

function parseWebViewMessage(data: string): TerminalWebViewMessage | null {
  try {
    return JSON.parse(data) as TerminalWebViewMessage;
  } catch {
    return null;
  }
}

type WebViewConnectionState =
  "loading" | "connected" | "disconnected" | "error";

export function TerminalPanel({ bottomInset = 0 }: TerminalPanelProps) {
  const { colors, spacing, typography } = useTheme();
  const { client, config, project, basicAuthCredential, activeDirectory } =
    useConnection();
  const { data: currentProject, isLoading: projectLoading } =
    useCurrentProject();
  const { terminalShell } = usePreferences();
  const [webViewState, setWebViewState] =
    useState<WebViewConnectionState>("loading");
  const [webViewError, setWebViewError] = useState<string | null>(null);
  const webViewRef = useRef<WebView>(null);

  const directory =
    activeDirectory ?? currentProject?.worktree ?? project?.worktree ?? null;

  const { ptyId, status, error, retry, reset } = usePtySession(
    directory,
    terminalShell,
  );

  const { wsUrl, authError } = useMemo(() => {
    if (!config || !ptyId || !directory) {
      return { wsUrl: null, authError: null };
    }

    try {
      const url = buildTerminalWebSocketUrl({
        baseUrl: config.baseUrl,
        ptyId,
        directory,
        username: basicAuthCredential?.username ?? config.username,
        password: basicAuthCredential?.password,
      });
      return { wsUrl: url, authError: null };
    } catch (err) {
      return {
        wsUrl: null,
        authError:
          err instanceof Error ? err.message : "Failed to build WebSocket URL",
      };
    }
  }, [basicAuthCredential, config, directory, ptyId]);

  const terminalPayload = useMemo(() => {
    if (!wsUrl) return null;
    return {
      wsUrl,
      auth: {
        username: basicAuthCredential?.username ?? config?.username,
        password: basicAuthCredential?.password ?? "",
        hasAuth: !!(
          basicAuthCredential?.password ||
          (config?.useAuth && config?.username)
        ),
      },
    };
  }, [wsUrl, basicAuthCredential, config]);

  const injectedBeforeLoad = useMemo(() => {
    if (!terminalPayload) {
      return "window.__TERMINAL__ = { wsUrl: null }; true;";
    }
    return `window.__TERMINAL__ = ${JSON.stringify(terminalPayload)}; true;`;
  }, [terminalPayload]);

  const themeScript = useMemo(() => {
    return `window.__TERMINAL_THEME__ = ${JSON.stringify({ background: colors.surface, foreground: colors.text })}; true;`;
  }, [colors.surface, colors.text]);

  const htmlWithTheme = useMemo(
    () =>
      TERMINAL_SHELL_HTML.replace(
        "</body>",
        `<script>${themeScript}</script></body>`,
      ),
    [themeScript],
  );

  const handleResize = useCallback(
    (cols: number, rows: number) => {
      if (!client || !ptyId || !directory) {
        return;
      }

      void client.pty.update({
        path: { id: ptyId },
        query: { directory },
        body: {
          size: { cols, rows },
        },
      });
    },
    [client, directory, ptyId],
  );

  const handleWebViewMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const message = parseWebViewMessage(event.nativeEvent.data);
      if (!message) {
        return;
      }

      if (message.type === "connected") {
        setWebViewState("connected");
        setWebViewError(null);
      }

      if (message.type === "disconnected") {
        setWebViewState("disconnected");
        setWebViewError(`Shell disconnected (code ${message.code ?? "?"})`);
      }

      if (message.type === "error") {
        setWebViewState("error");
        setWebViewError(message.message ?? "WebSocket error");
      }

      if (
        message.type === "resize" &&
        typeof message.cols === "number" &&
        typeof message.rows === "number"
      ) {
        handleResize(message.cols, message.rows);
      }
    },
    [handleResize],
  );

  const handleWebViewReload = useCallback(() => {
    setWebViewState("loading");
    setWebViewError(null);
    reset();
  }, [reset]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          paddingBottom: bottomInset,
        },
        centered: {
          alignItems: "center",
          flex: 1,
          gap: spacing.md,
          justifyContent: "center",
          paddingHorizontal: spacing.lg,
        },
        message: {
          color: colors.textMuted,
          fontSize: typography.body,
          textAlign: "center",
        },
        errorMessage: {
          color: colors.danger,
          fontSize: typography.body,
          textAlign: "center",
          marginTop: spacing.md,
        },
        retryButton: {
          backgroundColor: colors.accentMuted,
          borderRadius: 999,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.sm,
          marginTop: spacing.md,
        },
        retryLabel: {
          color: colors.text,
          fontSize: typography.body,
          fontWeight: "600",
        },
        title: {
          color: colors.text,
          fontSize: typography.subtitle,
          fontWeight: "700",
        },
        webview: {
          backgroundColor: colors.surface,
          flex: 1,
        },
        statusBar: {
          alignItems: "center",
          backgroundColor: colors.surfaceElevated,
          borderBottomColor: colors.border,
          borderBottomWidth: 1,
          flexDirection: "row",
          flexWrap: "wrap",
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.xs,
        },
        statusConnected: {
          color: colors.success,
        },
        statusError: {
          color: colors.danger,
        },
        statusLoading: {
          color: colors.textMuted,
        },
        statusText: {
          fontSize: typography.caption,
          fontWeight: "600",
        },
        shellLabel: {
          color: colors.textMuted,
          fontSize: typography.caption,
          marginLeft: "auto",
        },
        authErrorContainer: {
          backgroundColor: colors.surfaceElevated,
          borderColor: colors.danger,
          borderWidth: 1,
          borderRadius: spacing.xs,
          padding: spacing.md,
          marginHorizontal: spacing.lg,
          marginTop: spacing.md,
        },
        authErrorTitle: {
          color: colors.danger,
          fontSize: typography.body,
          fontWeight: "600",
          marginBottom: spacing.xs,
        },
        authErrorMessage: {
          color: colors.text,
          fontSize: typography.caption,
        },
      }),
    [bottomInset, colors, spacing, typography],
  );

  if (projectLoading && !directory) {
    return (
      <View style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.message}>Loading project...</Text>
        </View>
      </View>
    );
  }

  if (!directory) {
    return (
      <View style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.title}>Terminal unavailable</Text>
          <Text style={styles.message}>
            OpenCode has not reported a project directory for this session yet.
          </Text>
        </View>
      </View>
    );
  }

  if (status === "error" || !wsUrl) {
    const errorMessage =
      status === "error" ? error : authError || "Unknown error";
    return (
      <View style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.title}>Terminal failed</Text>
          <Text style={styles.message}>{errorMessage}</Text>
          {authError ? (
            <View style={styles.authErrorContainer}>
              <Text style={styles.authErrorTitle}>Authentication Required</Text>
              <Text style={styles.authErrorMessage}>
                The terminal requires authentication credentials. Please check
                your OpenCode server configuration.
              </Text>
            </View>
          ) : null}
          <Pressable onPress={() => void retry()} style={styles.retryButton}>
            <Text style={styles.retryLabel}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (status === "loading") {
    return (
      <View style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.message}>Starting shell...</Text>
        </View>
      </View>
    );
  }

  const statusLabel =
    webViewState === "connected"
      ? "Shell connected"
      : webViewState === "disconnected"
        ? (webViewError ?? "Shell disconnected")
        : webViewState === "error"
          ? (webViewError ?? "Terminal error")
          : "Connecting to shell...";

  const statusStyle =
    webViewState === "connected"
      ? styles.statusConnected
      : webViewState === "loading"
        ? styles.statusLoading
        : styles.statusError;

  const showReconnect =
    webViewState === "error" || webViewState === "disconnected";

  const shellDisplayName =
    terminalShell === "auto"
      ? "auto"
      : terminalShell.charAt(0).toUpperCase() + terminalShell.slice(1);

  return (
    <View style={styles.container}>
      <Pressable
        disabled={!showReconnect}
        onPress={showReconnect ? handleWebViewReload : undefined}
        style={styles.statusBar}
      >
        <Text style={[styles.statusText, statusStyle]}>{statusLabel}</Text>
        {showReconnect ? (
          <Text style={[styles.statusText, styles.statusError]}>
            {" "}
            - Tap to reconnect
          </Text>
        ) : null}
        {webViewState === "connected" ? (
          <Text style={styles.shellLabel}>{shellDisplayName}</Text>
        ) : null}
      </Pressable>
      <WebView
        ref={webViewRef}
        allowsInlineMediaPlayback
        domStorageEnabled
        injectedJavaScriptBeforeContentLoaded={injectedBeforeLoad}
        javaScriptEnabled
        keyboardDisplayRequiresUserAction={false}
        mixedContentMode="always"
        onMessage={handleWebViewMessage}
        onContentProcessDidTerminate={handleWebViewReload}
        originWhitelist={["*"]}
        source={{ html: htmlWithTheme, baseUrl: config?.baseUrl }}
        style={styles.webview}
      />
    </View>
  );
}
