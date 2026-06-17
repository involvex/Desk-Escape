import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ConnectionScreen } from "@/screens/ConnectionScreen";
import { WorkspaceScreen } from "@/screens/WorkspaceScreen";

export type RootStackParamList = {
  Connection: undefined;
  Workspace: undefined;
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
    </Stack.Navigator>
  );
}
