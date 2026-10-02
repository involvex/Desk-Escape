// TerminalPanel.tsx - xterm.js terminal backed by an OpenCode V2 PTY.
//
// Auth note: the shell no longer authenticates the socket with credentials.
// V2 issues a short-lived connect ticket over HTTP
// (`POST /api/pty/{id}/connect-token`) that travels in the WebSocket query
// string, so `basicAuthCredential` is no longer needed here.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { useCurrentProject } from "@/api/hooks";
import { requestPtyConnectTicket, usePtySession } from "@/api/use-pty-session";
import { toOpenCodeError, withOpenCodeErrors } from "@/api/opencode/errors";
import { withLocation } from "@/api/opencode/location";
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
  const { client, config, project, activeDirectory } = useConnection();
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

  // V2 socket auth. The ticket is short-lived, so it is fetched per (re)connect
  // instead of being derived from the connection credentials like V1's
  // `auth_token` query parameter was. The result is stored together with the key
  // it belongs to, so a new request invalidates the previous ticket without a
  // synchronous `setState` in the effect body.
  const [ticketNonce, setTicketNonce] = useState(0);
  const ticketKey =
    client && ptyId && directory
      ? `${config?.baseUrl ?? ""}:${ptyId}:${directory}:${ticketNonce}`
      : null;
  const [ticketState, setTicketState] = useState<{
    key: string | null;
    ticket: string | null;
    error: string | null;
  }>({ key: null, ticket: null, error: null });

  const ticket = ticketState.key === ticketKey ? ticketState.ticket : null;
  const ticketError = ticketState.key === ticketKey ? ticketState.error : null;

  useEffect(() => {
    if (!ticketKey || !client || !ptyId || !directory) {
      return;
    }

    let cancelled = false;

    requestPtyConnectTicket(client, ptyId, directory)
      .then((result) => {
        if (!cancelled) {
          setTicketState({
            key: ticketKey,
            ticket: result.ticket,
            error: null,
          });
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setTicketState({
            key: ticketKey,
            ticket: null,
            error: toOpenCodeError(caught).message,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [client, directory, ptyId, ticketKey]);

  const { wsUrl, buildError } = useMemo(() => {
    if (!config || !ptyId || !directory || !ticket) {
      return { wsUrl: null, buildError: null as string | null };
    }

    try {
      const url = buildTerminalWebSocketUrl({
        baseUrl: config.baseUrl,
        ptyId,
        ticket,
        directory,
        cursor: 0,
      });
      return { wsUrl: url, buildError: null as string | null };
    } catch (err) {
      return {
        wsUrl: null,
        buildError:
          err instanceof Error ? err.message : "Failed to build WebSocket URL",
      };
    }
  }, [config, directory, ptyId, ticket]);

  const terminalPayload = useMemo(() => {
    if (!wsUrl) return null;
    return {
      wsUrl,
      // Kept alongside the URL (which already carries the ticket) so the
      // injected shell payload documents how the socket was authenticated.
      auth: {
        ticket: ticket ?? "",
        hasTicket: Boolean(ticket),
      },
    };
  }, [wsUrl, ticket]);

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

      // V2 takes `ptyID` + a `location` scope, with the size inlined next to the
      // other updatable fields (`title`) rather than in a nested `body`.
      // A failed resize only affects the server-side window size, so it is
      // swallowed rather than surfaced on top of a working terminal.
      void withOpenCodeErrors(() =>
        client.pty.update({
          ptyID: ptyId,
          ...withLocation(directory),
          size: { cols, rows },
        }),
      ).catch(() => undefined);
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
    // The old connect ticket may already be expired, so force a fresh one.
    setTicketNonce((value) => value + 1);
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
        ticketErrorContainer: {
          backgroundColor: colors.surfaceElevated,
          borderColor: colors.danger,
          borderWidth: 1,
          borderRadius: spacing.xs,
          padding: spacing.md,
          marginHorizontal: spacing.lg,
          marginTop: spacing.md,
        },
        ticketErrorTitle: {
          color: colors.danger,
          fontSize: typography.body,
          fontWeight: "600",
          marginBottom: spacing.xs,
        },
        ticketErrorMessage: {
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

  const sessionError: string | null = status === "error" ? error : null;
  const terminalError: string | null =
    sessionError ?? ticketError ?? buildError;

  if (terminalError) {
    const errorMessage = terminalError;
    return (
      <View style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.title}>Terminal failed</Text>
          <Text style={styles.message}>{errorMessage}</Text>
          {ticketError ? (
            <View style={styles.ticketErrorContainer}>
              <Text style={styles.ticketErrorTitle}>
                Connect ticket refused
              </Text>
              <Text style={styles.ticketErrorMessage}>
                OpenCode would not issue a WebSocket connect ticket for this
                PTY. Check that the server allows this client, then retry.
              </Text>
            </View>
          ) : null}
          <Pressable
            onPress={() => {
              // A ticket failure is not fixed by re-listing the PTY, so force a
              // fresh ticket request on retry as well.
              setTicketNonce((value) => value + 1);
              void retry();
            }}
            style={styles.retryButton}
          >
            <Text style={styles.retryLabel}>Retry</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (!wsUrl) {
    return (
      <View style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.message}>
            {status === "ready" ? "Authorizing shell..." : "Starting shell..."}
          </Text>
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
