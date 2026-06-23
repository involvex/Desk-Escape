import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { PendingPermission } from "@/api/permissions";

const PERMISSION_CHANNEL_ID = "agent-permissions";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function ensureNotificationPermissions(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === "granted") {
    return true;
  }

  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

export async function setupNotificationChannel(): Promise<void> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(PERMISSION_CHANNEL_ID, {
      name: "Agent permission requests",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
    });
  }
}

export async function notifyPermissionRequest(
  permission: PendingPermission,
): Promise<void> {
  await setupNotificationChannel();

  await Notifications.scheduleNotificationAsync({
    content: {
      title: permission.title,
      body: permission.description || "Open Desk Escape to approve or reject.",
      data: {
        type: "permission",
        permissionId: permission.id,
        sessionId: permission.sessionId,
      },
      ...(Platform.OS === "android"
        ? { channelId: PERMISSION_CHANNEL_ID }
        : {}),
    },
    trigger: null,
  });
}
