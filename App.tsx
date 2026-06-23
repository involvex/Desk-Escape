import { GestureHandlerRootView } from "react-native-gesture-handler";
import { NavigationContainer } from "@react-navigation/native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ConnectionProvider } from "@/context/ConnectionContext";
import { OrientationProvider } from "@/context/OrientationContext";
import { ThemeProvider, useTheme } from "@/context/ThemeContext";
import { RootNavigator } from "@/navigation/RootNavigator";

const queryClient = new QueryClient();

function AppShell() {
  const { theme } = useTheme();

  return (
    <>
      <StatusBar style={theme.statusBar} />
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>
    </>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <OrientationProvider>
              <ConnectionProvider>
                <AppShell />
              </ConnectionProvider>
            </OrientationProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
