import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ActivityIndicator, View } from "react-native";
import { usePreferences } from "@/context/PreferencesContext";
import { useTheme } from "@/context/ThemeContext";
import { ConnectionScreen } from "@/screens/ConnectionScreen";
import { CursorConnectionScreen } from "@/screens/CursorConnectionScreen";
import { CursorSessionScreen } from "@/screens/CursorSessionScreen";
import { PluginManagerScreen } from "@/screens/PluginManagerScreen";
import { ProviderPickerScreen } from "@/screens/ProviderPickerScreen";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { WorkspaceScreen } from "@/screens/WorkspaceScreen";

export type RootStackParamList = {
  ProviderPicker: undefined;
  Connection: undefined;
  CursorConnection: undefined;
  CursorSessions: undefined;
  Workspace: undefined;
  Settings: undefined;
  Plugins: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { showCursorAgents, preferencesReady } = usePreferences();
  const { colors } = useTheme();

  if (!preferencesReady) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <Stack.Navigator
      initialRouteName={showCursorAgents ? "ProviderPicker" : "Connection"}
      screenOptions={{
        headerShown: false,
        animation: "fade",
      }}
    >
      <Stack.Screen name="ProviderPicker" component={ProviderPickerScreen} />
      <Stack.Screen name="Connection" component={ConnectionScreen} />
      <Stack.Screen
        name="CursorConnection"
        component={CursorConnectionScreen}
      />
      <Stack.Screen name="CursorSessions" component={CursorSessionScreen} />
      <Stack.Screen name="Workspace" component={WorkspaceScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="Plugins" component={PluginManagerScreen} />
    </Stack.Navigator>
  );
}
