import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ConnectionScreen } from "@/screens/ConnectionScreen";
import { PluginManagerScreen } from "@/screens/PluginManagerScreen";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { WorkspaceScreen } from "@/screens/WorkspaceScreen";

export type RootStackParamList = {
  Connection: undefined;
  Workspace: undefined;
  Settings: undefined;
  Plugins: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="Connection"
      screenOptions={{
        headerShown: false,
        animation: "fade",
      }}
    >
      <Stack.Screen name="Connection" component={ConnectionScreen} />
      <Stack.Screen name="Workspace" component={WorkspaceScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="Plugins" component={PluginManagerScreen} />
    </Stack.Navigator>
  );
}
