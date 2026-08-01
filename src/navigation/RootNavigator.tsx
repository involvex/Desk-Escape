import { createNativeStackNavigator } from "@react-navigation/native-stack";
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
  return (
    <Stack.Navigator
      initialRouteName="ProviderPicker"
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
