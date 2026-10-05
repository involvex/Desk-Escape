import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  IMPLEMENTED,
  INERT as STUB_INERT,
  reactNativeStub,
} from "@/testing/react-native-stub";

/**
 * Keeps the `react-native` shim honest.
 *
 * The failure this prevents is specific and quiet: a component starts importing
 * `Switch`, the shim does not have it, and the component renders nothing — so the
 * test still passes while asserting nothing. Scanning the app's own imports turns
 * that into a red test the moment it happens.
 */

const SRC = join(import.meta.dir, "..", "..");

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (
      entry === "node_modules" ||
      entry === "__tests__" ||
      entry === "testing"
    ) {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Every named import the app takes from `react-native`, ignoring type-only ones.
 */
function reactNativeImports(): Set<string> {
  const names = new Set<string>();
  const pattern =
    /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']react-native["']/g;

  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(pattern)) {
      for (const part of (match[1] ?? "").split(",")) {
        const trimmed = part.trim();
        // `import { AppState, type AppStateStatus }` — a `type` prefix erases at
        // compile time, so it needs no runtime stub. Keeping it would demand a
        // runtime export for a type and fail the suite for no reason.
        if (!trimmed || /^type\s/.test(trimmed)) {
          continue;
        }
        const name = trimmed.split(/\s+as\s+/)[0]?.trim();
        if (name) names.add(name);
      }
    }
    // Default-import form, e.g. `import RN from "react-native"`.
    for (const match of source.matchAll(
      /import\s+(\w+)\s+from\s*["']react-native["']/g,
    )) {
      if (match[1]) names.add(match[1]);
    }
  }
  return names;
}

/**
 * Imports with no runtime stub, split by why.
 *
 * Requiring full coverage would mean faking `Animated` and `PanResponder`, and a
 * bad fake of either is worse than an honest gap: tests would pass against a
 * component that behaves nothing like the real one. Listing them keeps the gap
 * *visible* — `IMPLEMENTED` plus both records has to equal what the app imports,
 * so a brand-new import still fails the suite.
 */

/** Imported without a `type` keyword, but only ever used in a type position. */
const TYPE_ONLY_UNMARKED = [
  // TypeScript elides these at compile time. Telling them apart needs full type
  // information, so the scan records them rather than stubbing no-op values.
  "LayoutChangeEvent",
  "NativeScrollEvent",
  "NativeSyntheticEvent",
];

/** Genuinely absent, with the reason a fake would mislead. */
const NOT_STUBBED: Record<string, string> = {
  PanResponder: "gesture plumbing; use Pressable in tested components",
  Keyboard: "native keyboard timing is not observable here",
  Modal: "native presentation; renders inline in the tree instead",
  Share: "OS share sheet; nothing to assert",
  Switch: "value tracking works, but no tested screen uses it yet",
  TextInput: "keyboard focus is not observable here",
  AppState: "lifecycle transitions need a device",
};

/**
 * Exported so the module graph links, but explicitly *not* covered.
 *
 * This list exists because "absent" is not one state. A name in `NOT_STUBBED` makes
 * any component importing it unrenderable — the graph fails to link before a test
 * can run. A name here is provided in a form that renders and does nothing else, so
 * the component above it loads and its logic can be exercised, but nothing about the
 * faked member's behaviour is on the evidence.
 *
 * `Animated` is the case: `CollapsiblePartGroup` pulses a streaming tool call with
 * it. Omitting `Animated` made every bubble unrenderable; providing a fake that
 * renders but never advances made the bubble testable. What that test can conclude
 * is "the bubble offers these actions", never "the pulse animates" — so the fake is
 * named here instead of in `IMPLEMENTED`, where it would read as coverage.
 */
const INERT: Record<string, string> = {
  Animated:
    "renders but never advances; assertions must be on state, never on motion",
};

/** Everything the coverage check considers accounted for. */
const ACCOUNTED = new Set<string>([
  ...IMPLEMENTED,
  ...Object.keys(INERT),
  ...TYPE_ONLY_UNMARKED,
  ...Object.keys(NOT_STUBBED),
]);

describe("react-native stub coverage", () => {
  const imported = reactNativeImports();

  test("the scan found the app's react-native usage", () => {
    // If this is zero the scan is broken and every check below would pass
    // vacuously — the exact kind of false green this file exists to prevent, so
    // it is asserted rather than assumed.
    expect(imported.size).toBeGreaterThan(10);
  });

  test("every react-native import is accounted for", () => {
    const unaccounted = [...imported].filter((name) => !ACCOUNTED.has(name));
    expect(unaccounted).toEqual([]);
  });

  test("every implemented export is actually imported somewhere", () => {
    // The reverse direction: an entry in IMPLEMENTED that nothing uses is either
    // a typo or a leftover, and either way it is misleading documentation.
    const unused = IMPLEMENTED.filter((name) => !imported.has(name));
    expect(unused).toEqual([]);
  });

  test("no gap entry is stale", () => {
    // If one of these is implemented now, or is no longer imported, the records
    // above have stopped describing reality.
    const stale = [...ACCOUNTED].filter((name) => !imported.has(name));
    expect(stale).toEqual([]);
  });

  test("inline `type` specifiers are excluded from the scan", () => {
    // Guards the parser: if `type X` specifiers leaked back in, this fails
    // rather than demanding a runtime export for a compile-time-only name.
    expect(imported.has("AppStateStatus")).toBe(false);
  });

  test("IMPLEMENTED matches what the stub module exposes", () => {
    for (const name of IMPLEMENTED) {
      expect(reactNativeStub[name]).toBeDefined();
    }
  });

  test("every inert fake is exported but not counted as covered", () => {
    // The two halves of the distinction, asserted together because either alone is
    // misleading: an inert fake that is not exported is a broken module graph, and
    // an exported one listed in `IMPLEMENTED` is a fake claiming to be coverage.
    for (const name of Object.keys(INERT)) {
      expect(reactNativeStub[name]).toBeDefined();
      expect(IMPLEMENTED).not.toContain(name as never);
    }
  });

  test("the inert list here and in the stub agree", () => {
    // The stub owns what it exports; this file owns why. Splitting membership from
    // rationale means it can drift, and a name silently moving between them is
    // exactly the mislabelling these lists exist to prevent. Compared as sets because
    // the stub's list is a one-element tuple and `toEqual` would compare literal
    // element types, failing for a reason that has nothing to do with the drift.
    expect(new Set<string>(STUB_INERT)).toEqual(
      new Set<string>(Object.keys(INERT)),
    );
  });

  test("an unimplemented member throws instead of returning undefined", () => {
    // This is what turns silent divergence into a visible failure: a component
    // asking for something the shim lacks must not get `undefined` and render
    // nothing while the test still passes.
    expect(
      () => (reactNativeStub as Record<string, unknown>).Nonexistent,
    ).toThrow(/does not implement `Nonexistent`/);
  });
});
