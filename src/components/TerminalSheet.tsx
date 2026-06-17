import BottomSheet, { BottomSheetView } from "@gorhom/bottom-sheet";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Platform, StyleSheet } from "react-native";
import { WebView } from "react-native-webview";
import { useConnection } from "@/context/ConnectionContext";
import { useTheme } from "@/context/ThemeContext";

interface TerminalSheetProps {
  expanded: boolean;
  onIndexChange?: (index: number) => void;
}

export function TerminalSheet({ expanded, onIndexChange }: TerminalSheetProps) {
  const { colors } = useTheme();
  const { config, authHeader, basicAuthCredential } = useConnection();
  const sheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ["10%", "45%", "95%"], []);

  useEffect(() => {
    if (expanded) {
      sheetRef.current?.snapToIndex(1);
      return;
    }

    sheetRef.current?.snapToIndex(0);
  }, [expanded]);

  const handleSheetChanges = useCallback(
    (index: number) => {
      onIndexChange?.(index);
    },
    [onIndexChange],
  );

  const webViewSource = useMemo(() => {
    if (!config) {
      return undefined;
    }

    if (Platform.OS === "android" && authHeader) {
      return {
        uri: config.baseUrl,
        headers: { Authorization: authHeader },
      };
    }

    return { uri: config.baseUrl };
  }, [authHeader, config]);

  if (!config || !webViewSource) {
    return null;
  }

  return (
    <BottomSheet
      ref={sheetRef}
      index={0}
      onChange={handleSheetChanges}
      snapPoints={snapPoints}
      backgroundStyle={{ backgroundColor: colors.surface }}
      handleIndicatorStyle={{ backgroundColor: colors.textMuted }}
    >
      <BottomSheetView style={styles.content}>
        <WebView
          basicAuthCredential={basicAuthCredential ?? undefined}
          cacheEnabled
          javaScriptEnabled
          originWhitelist={["*"]}
          sharedCookiesEnabled
          source={webViewSource}
          style={styles.webview}
        />
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    minHeight: 180,
  },
  webview: {
    flex: 1,
  },
});
