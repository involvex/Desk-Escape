/**
 * The permission context's public surface.
 *
 * This module is a **seam**, not an implementation. It exists so two things can
 * coexist that otherwise could not:
 *
 *   - the app imports `@/context/PermissionContext` and gets the real provider;
 *   - the test preload substitutes this one specifier, so components that only
 *     *read* `usePermission` can render without standing up an SSE subscription, a
 *     rehydration fetch, and a notification listener.
 *
 * The implementation lives in `@/context/permission-provider`, which the preload does
 * **not** substitute. Tests of the provider's own behaviour import that module
 * directly, so the queue wiring, the auto-approve path, the rehydration and the
 * notification listener can all be driven for real.
 *
 * The split is a second of duplication and nothing else: one export each, no logic
 * here. It exists because the alternative was a provider with no tests, which is
 * what this codebase had for as long as the module was written.
 */
export {
  PermissionProvider,
  usePermission,
} from "@/context/permission-provider";
export type { PermissionContextValue } from "@/context/permission-provider";
