import {
  BottomSheetModal,
  BottomSheetView,
  type BottomSheetModal as BottomSheetModalType,
} from "@gorhom/bottom-sheet";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform, StyleSheet } from "react-native";
import { WebView } from "react-native-webview";
import { useConnection } from "@/context/ConnectionContext";
import { useTheme } from "@/context/ThemeContext";

export interface TerminalSheetHandle {
  present: () => void;
  dismiss: () => void;
}

interface TerminalSheetProps {
  onDismiss?: () => void;
}

export const TerminalSheet = forwardRef<
  TerminalSheetHandle,
  TerminalSheetProps
>(function TerminalSheet({ onDismiss }, ref) {
  const { colors } = useTheme();
  const { config, authHeader, basicAuthCredential } = useConnection();
  const sheetRef = useRef<BottomSheetModalType>(null);
  const [webViewMounted, setWebViewMounted] = useState(false);
  const snapPoints = useMemo(() => ["45%", "95%"], []);

  useImperativeHandle(ref, () => ({
    present: () => {
      setWebViewMounted(true);
      sheetRef.current?.present();
    },
    dismiss: () => {
      sheetRef.current?.dismiss();
    },
  }));

  const handleDismiss = useCallback(() => {
    onDismiss?.();
  }, [onDismiss]);

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

  if (!config) {
    return null;
  }

  return (
    <BottomSheetModal
      ref={sheetRef}
      enablePanDownToClose
      onDismiss={handleDismiss}
      snapPoints={snapPoints}
      backgroundStyle={{ backgroundColor: colors.surface }}
      handleIndicatorStyle={{ backgroundColor: colors.textMuted }}
    >
      <BottomSheetView style={styles.content}>
        {webViewMounted && webViewSource ? (
          <WebView
            basicAuthCredential={basicAuthCredential ?? undefined}
            cacheEnabled
            javaScriptEnabled
            originWhitelist={["*"]}
            sharedCookiesEnabled
            source={webViewSource}
            style={styles.webview}
          />
        ) : null}
      </BottomSheetView>
    </BottomSheetModal>
  );
});

const styles = StyleSheet.create({
  content: {
    flex: 1,
    minHeight: 180,
  },
  webview: {
    flex: 1,
  },
});
