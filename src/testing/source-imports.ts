import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Reads the app's own imports, for building test doubles that satisfy them.
 *
 * A `Proxy` cannot stand in for a module here: Bun resolves *named* ESM imports
 * statically, so a proxy that answers any property still fails with
 * "Export named 'X' not found". The icon set has to exist as real keys.
 *
 * Scanning the source keeps that set honest: adding an icon to a component is
 * picked up automatically, so the double never becomes the reason a component
 * fails to load in a test.
 */

const SRC_ROOT = join(import.meta.dir, "..");

/** Source files under `src/`, skipping tests and this directory. */
export function appSourceFiles(dir: string = SRC_ROOT): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "testing") continue;
      found.push(...appSourceFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Runtime (non-type) named imports taken from `moduleName`.
 *
 * `import { A, type B }` yields `A` only: a `type` specifier is erased at compile
 * time and needs no runtime export.
 */
export function collectNamedImports(
  moduleName: string,
  dir: string = SRC_ROOT,
): Set<string> {
  const names = new Set<string>();
  const escaped = moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const braced = new RegExp(
    `import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s*from\\s*["']${escaped}["']`,
    "g",
  );
  const single = new RegExp(
    `import\\s+(\\w+)\\s+from\\s*["']${escaped}["']`,
    "g",
  );

  for (const file of appSourceFiles(dir)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(braced)) {
      for (const part of (match[1] ?? "").split(",")) {
        const trimmed = part.trim();
        if (!trimmed || /^type\s/.test(trimmed)) continue;
        const name = trimmed.split(/\s+as\s+/)[0]?.trim();
        if (name) names.add(name);
      }
    }
    for (const match of source.matchAll(single)) {
      if (match[1]) names.add(match[1]);
    }
  }
  return names;
}
