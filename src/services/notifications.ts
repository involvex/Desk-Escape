import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { PendingPermission, PermissionResponse } from "@/api/permissions";

const PERMISSION_CHANNEL_ID = "agent-permissions";
const PERMISSION_CATEGORY_ID = "permission-request";

export type PermissionAction = "allow" | "reject" | "always-allow";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function setupPermissionCategory(): Promise<void> {
  await Notifications.setNotificationCategoryAsync(PERMISSION_CATEGORY_ID, [
    {
      identifier: "allow",
      buttonTitle: "Allow",
      options: { isAuthenticationRequired: false },
    },
    {
      identifier: "reject",
      buttonTitle: "Reject",
      options: { isDestructive: true, isAuthenticationRequired: false },
    },
    {
      identifier: "always-allow",
      buttonTitle: "Always Allow",
      options: { isAuthenticationRequired: false },
    },
  ]);
}

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
  await setupPermissionCategory();
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
      // @ts-expect-error categoryId is supported but not in types
      categoryId: PERMISSION_CATEGORY_ID,
      ...(Platform.OS === "android"
        ? { channelId: PERMISSION_CHANNEL_ID }
        : {}),
    },
    trigger: null,
  });
}

export function actionToResponse(action: PermissionAction): PermissionResponse {
  switch (action) {
    case "allow":
      return "once";
    case "always-allow":
      return "always";
    case "reject":
      return "reject";
  }
}
