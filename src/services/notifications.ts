import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { PendingPermission } from "@/api/permissions";

/**
 * Permission notifications.
 *
 * ## What works, and what does not
 *
 * **Permission requests are foreground-only, and no approval taken from a
 * notification survives the app being killed.** That is not a limitation of this
 * module, it is a limitation of the platform surface the app currently has, and it
 * is worth stating plainly because everything here looks like it works:
 *
 *   - **No `TaskManager` background task.** A permission raised while the app is
 *     killed produces no notification at all, because nothing is running to notice
 *     it. The request is still outstanding on the server and reappears when the app
 *     next connects — that is the rehydration path, and it is the only thing that
 *     brings a killed-app request back.
 *   - **No push token, no server-side push.** Notifications are posted by this app,
 *     from this process, while it is alive. There is nothing on the server to send
 *     one, so nothing arrives while the app is not running.
 *   - **A tap while the app is killed foregrounds it, and the JS runtime starts
 *     cold.** The response is handed to the emitter *before* any listener exists, so
 *     the listener alone misses it. `PermissionProvider` therefore reads
 *     `getLastNotificationResponse()` after registering, mirroring what the package's
 *     own `useLastNotificationResponse` does and why.
 *
 * ## What Phase 1 guarantees about a tap that does arrive
 *
 * A tap that reaches the app is never dropped. If there is no client to answer with,
 * the reply is held and sent once one exists, and the request is left in the visible
 * queue meanwhile. That is the whole of the guarantee, and it is deliberately
 * modest: it makes the foreground path honest, and it cannot make the killed-app path
 * work. Only a background task plus server-side push can do that, which is Phase 2.
 *
 * ## The action buttons
 *
 * `opensAppToForeground` is left at its default of `true` and stated explicitly here
 * rather than relied on. The package documents that a `false` action does **not**
 * reach the listener when the app is killed — which would be fine, except that it
 * would make the notification's own dismissal the only record that the user tapped,
 * and the reply would be lost rather than deferred. Foregrounding is what gives the
 * cold-start read something to find.
 */

const PERMISSION_CHANNEL_ID = "agent-permissions";
const PERMISSION_CATEGORY_ID = "permission-request";

export {
  actionToResponse,
  type PermissionAction,
} from "@/api/notification-replies";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Register the permission category and its three buttons.
 *
 * Idempotent — every posted notification calls it — because a category must exist
 * before a notification can reference one, and the alternative was remembering to
 * register at some earlier moment that nothing else guarantees.
 */
export async function setupPermissionCategory(): Promise<void> {
  await Notifications.setNotificationCategoryAsync(PERMISSION_CATEGORY_ID, [
    {
      identifier: "allow",
      buttonTitle: "Allow",
      options: { isAuthenticationRequired: false, opensAppToForeground: true },
    },
    {
      identifier: "reject",
      buttonTitle: "Reject",
      options: {
        isDestructive: true,
        isAuthenticationRequired: false,
        opensAppToForeground: true,
      },
    },
    {
      identifier: "always-allow",
      buttonTitle: "Always Allow",
      options: { isAuthenticationRequired: false, opensAppToForeground: true },
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
