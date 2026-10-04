import { beforeEach, describe, expect, test } from "bun:test";

import { SavedPermissionsScreen } from "@/screens/SavedPermissionsScreen";
import {
  apiStub,
  setRemovePermission,
  setSavedPermissions,
} from "@/testing/context-holds";
import { act, renderWithProviders, takeAlertCalls } from "@/testing/harness";

/**
 * Render tests for the persisted-grant list.
 *
 * `saved-permissions.test.ts` covers the pure presentation helpers. This file
 * covers the promises the screen makes: that a grant can actually be withdrawn, that
 * a withdrawal the server rejects does not silently disappear, and that the list is
 * scoped to a real project rather than to a directory that looks like one.
 */

/** One `PermissionSavedInfo`, as the server sends it. */
function grant(overrides: Record<string, unknown> = {}) {
  return {
    id: "grant_1",
    action: "bash",
    resource: "npm test",
    projectID: "prj_test",
    time: { updated: Date.now() - 3 * 60 * 60 * 1000 },
    ...overrides,
  };
}

function render(options: { project?: unknown } = {}) {
  return renderWithProviders(
    <SavedPermissionsScreen
      navigation={{ goBack: () => {} } as never}
      route={{} as never}
    />,
    options,
  );
}

beforeEach(() => {
  setSavedPermissions(async () => [grant()]);
  setRemovePermission(async () => undefined);
});

describe("SavedPermissionsScreen", () => {
  test("lists a grant with what it covers and how old it is", async () => {
    const result = await render();
    await result.flush();

    const text = result.text();
    expect(text).toContain("Persistent grants");
    // Labelled as `action: resource` — a specific target reads differently from a
    // blanket one, and rendering both as a bare string would hide that.
    expect(text).toContain("bash: npm test");
    expect(text).toContain("Granted 3h ago");
    expect(text).toContain("prj_test");
    result.unmount();
  });

  test("says a wildcard covers every request, not one command", async () => {
    setSavedPermissions(async () => [grant({ resource: "*" })]);
    const result = await render();
    await result.flush();

    const text = result.text();
    expect(text).toContain("Any bash command");
    expect(text).toContain("Covers every bash request");
    result.unmount();
  });

  test("scopes the request to the resolved project id, not the directory", async () => {
    // `permission.saved.list` filters on a project *id*. The screen used to pass
    // the filesystem directory straight through, which a live-server probe
    // (`scripts/probe-server-contracts.mjs`, Q2) showed is rejected exactly as a
    // random string is -- the screen simply rendered "No persistent grants"
    // forever, which reads identically to a project that has none.
    //
    // The two values are deliberately different here (`/repo` vs `prj_test`) so
    // this cannot pass by coincidence: sending the directory would fail it.
    const result = await render();
    await result.flush();

    expect(apiStub().savedPermissions.calls).toEqual([
      { projectID: "prj_test" },
    ]);
    expect(apiStub().savedPermissions.calls).not.toContainEqual({
      projectID: "/repo",
    });
    result.unmount();
  });

  test("asks for nothing rather than guessing a project", async () => {
    // No id means no request. Sending the directory "just in case" is the bug
    // being fixed, so the absence of a call is the assertion.
    //
    // `project` goes through `renderWithProviders` rather than `setCurrentProject`
    // because the harness resets its module slots on mount, which would undo a
    // value set beforehand.
    const result = await render({ project: null });
    await result.flush();

    expect(apiStub().savedPermissions.calls).toEqual([]);

    // The endpoint sees nothing either way, so the difference between "disabled"
    // and "enabled but threw in its own queryFn" is only visible in the cache. A
    // registered-but-disabled query stays `pending`; an enabled one fetches, trips
    // the "Project not resolved." guard, and lands on `error`.
    //
    // Without this, the `enabled:` gate is unobservable and could be deleted with
    // every test still green -- a query that runs and fails on every mount, forever.
    const state = result.queryClient.getQueryState([
      "saved-permissions",
      "/repo",
    ]);
    expect(state?.status).toBe("pending");

    result.unmount();
  });

  test("does not claim a project has no grants while the project is unknown", async () => {
    // "No persistent grants" is a claim about a specific project's grants. With
    // no project resolved the screen has asked nobody, so it must not make it --
    // and the grant stub would happily have answered if it had asked.
    setSavedPermissions(async () => [grant()]);

    const result = await render({ project: null });
    await result.flush();

    const text = result.text();
    expect(text).toContain("Resolving which project's grants to show");
    expect(text).not.toContain("No persistent grants");
    result.unmount();
  });

  test("says so when there is nothing to revoke", async () => {
    setSavedPermissions(async () => []);
    const result = await render();
    await result.flush();

    expect(result.text()).toContain("No persistent grants");
    result.unmount();
  });

  test("a specific grant is revoked without a confirmation", async () => {
    let remaining: unknown[] = [grant()];
    setSavedPermissions(async () => remaining);
    setRemovePermission(async () => {
      remaining = [];
    });

    const result = await render();
    await result.flush();
    takeAlertCalls();

    await result.pressAccessibility("Revoke bash: npm test");
    await result.flush();

    // Cheap to restore by answering the prompt again, so no extra beat.
    expect(takeAlertCalls()).toHaveLength(0);
    expect(apiStub().removePermission.calls).toEqual([{ id: "grant_1" }]);
    // The row disappears only after the server confirmed.
    expect(result.text()).not.toContain("bash: npm test");
    result.unmount();
  });

  test("a wildcard asks first, and cancelling changes nothing", async () => {
    setSavedPermissions(async () => [grant({ resource: "*" })]);
    const result = await render();
    await result.flush();

    await result.pressAccessibility("Revoke Any bash command");
    await result.flush();

    const alerts = takeAlertCalls();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.title).toBe("Revoke this grant?");
    // The warning is specific about the cost: a wildcard revocation re-prompts for
    // everything it silently covered.
    expect(alerts[0]!.message).toContain("will ask again");
    // Nothing sent until the destructive button is pressed.
    expect(apiStub().removePermission.calls).toHaveLength(0);
    result.unmount();
  });

  test("confirming a wildcard actually revokes it", async () => {
    let remaining: unknown[] = [grant({ resource: "*" })];
    setSavedPermissions(async () => remaining);
    setRemovePermission(async () => {
      remaining = [];
    });

    const result = await render();
    await result.flush();

    await result.pressAccessibility("Revoke Any bash command");
    await result.flush();

    const buttons = takeAlertCalls()[0]?.buttons as {
      text: string;
      onPress?: () => void;
    }[];
    const confirm = buttons.find((button) => button.text === "Revoke");
    expect(confirm).toBeDefined();

    await act(async () => {
      confirm!.onPress?.();
    });
    await result.flush();

    expect(apiStub().removePermission.calls).toEqual([{ id: "grant_1" }]);
    expect(result.text()).not.toContain("Any bash command");
    result.unmount();
  });

  test("a rejected revoke keeps the grant on screen", async () => {
    // The row is removed on confirmation, not optimistically, precisely so a
    // failure cannot leave the app claiming a grant is gone while it is still in
    // force.
    setRemovePermission(async () => {
      throw new Error("grant is still in use");
    });

    const result = await render();
    await result.flush();

    await result.pressAccessibility("Revoke bash: npm test");
    await result.flush();

    expect(result.text()).toContain("bash: npm test");
    expect(result.text()).toContain("grant is still in use");
    result.unmount();
  });

  test("surfaces a failed list", async () => {
    setSavedPermissions(async () => {
      throw new Error("server unreachable");
    });
    const result = await render();
    await result.flush();

    expect(result.text()).toContain("server unreachable");
    result.unmount();
  });

  test("shows the empty list rather than spinning forever when not connected", async () => {
    // The query is `enabled: Boolean(client)`, and a disabled query is pending
    // forever. Gating the spinner on `isPending` alone therefore left this screen
    // spinning with no client and no fetch to wait for — a state it could never
    // leave. Caught by rendering it.
    const result = await renderWithProviders(
      <SavedPermissionsScreen
        navigation={{ goBack: () => {} } as never}
        route={{} as never}
      />,
      { connection: { client: null } },
    );
    await result.flush();

    expect(apiStub().savedPermissions.calls).toHaveLength(0);
    expect(result.byType("ActivityIndicator")).toHaveLength(0);
    expect(result.text()).toContain("No persistent grants");
    result.unmount();
  });

  test("shows a spinner while the list is genuinely loading", async () => {
    let release: (value: unknown) => void = () => {};
    setSavedPermissions(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    const result = await render();
    expect(result.byType("ActivityIndicator")).toHaveLength(1);

    await act(async () => {
      release([]);
    });
    await result.flush();
    expect(result.byType("ActivityIndicator")).toHaveLength(0);
    result.unmount();
  });

  test("back goes back", async () => {
    let wentBack = false;
    const result = await renderWithProviders(
      <SavedPermissionsScreen
        navigation={{ goBack: () => (wentBack = true) } as never}
        route={{} as never}
      />,
    );
    await result.flush();

    await result.pressAccessibility("Back");
    expect(wentBack).toBe(true);
    result.unmount();
  });
});
