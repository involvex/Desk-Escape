import { describe, expect, test } from "bun:test";

import {
  contrastRatio,
  meetsLargeTextContrast,
  meetsTextContrast,
  parseHexColor,
  relativeLuminance,
} from "@/theme/color-contrast";
import { themeDefinitions, themeNames } from "@/theme/palettes";
import type { ThemeName } from "@/types/opencode";

// ---------------------------------------------------------------------------
// The maths
// ---------------------------------------------------------------------------

describe("parseHexColor", () => {
  test("parses a six-digit hex", () => {
    expect(parseHexColor("#1F2328")).toEqual([31, 35, 40]);
  });

  test("expands three-digit shorthand", () => {
    expect(parseHexColor("#fff")).toEqual([255, 255, 255]);
    expect(parseHexColor("#000")).toEqual([0, 0, 0]);
  });

  test("tolerates a missing leading hash and ignores case", () => {
    expect(parseHexColor("22D3EE")).toEqual([34, 211, 238]);
    expect(parseHexColor("#AbCdEf")).toEqual([171, 205, 239]);
  });

  test("rejects eight-digit hex rather than guessing at the alpha", () => {
    // WCAG is defined over opaque colours. Stripping the alpha would mean
    // confidently answering a question the caller never asked.
    expect(parseHexColor("#1F2328FF")).toBeNull();
    expect(parseHexColor("#1F232880")).toBeNull();
  });

  test("rejects non-hex and wrong-length values", () => {
    expect(parseHexColor("rgba(10, 10, 10, 0.88)")).toBeNull();
    expect(parseHexColor("#FFFFF")).toBeNull();
    expect(parseHexColor("#GGGGGG")).toBeNull();
    expect(parseHexColor("")).toBeNull();
  });
});

describe("relativeLuminance", () => {
  test("black is 0 and white is 1", () => {
    expect(relativeLuminance([0, 0, 0])).toBe(0);
    expect(relativeLuminance([255, 255, 255])).toBe(1);
  });

  test("matches the WCAG reference value for mid grey", () => {
    // #808080 is the canonical 0.2159 midpoint. If the sRGB transfer curve is
    // applied correctly this is the number WCAG publishes.
    expect(relativeLuminance([128, 128, 128])).toBeCloseTo(0.2159, 4);
  });

  test("is weighted per channel, so a colour and its reverse differ", () => {
    // This is not a symmetry to assert — it pins that the 0.2126/0.7152/0.0722
    // weights are actually applied. A plain channel average would score these two
    // identically, because they contain exactly the same three values.
    expect(relativeLuminance([34, 211, 238])).not.toBeCloseTo(
      relativeLuminance([238, 211, 34]),
      6,
    );
  });
});

describe("contrastRatio", () => {
  test("black on white is the 21:1 maximum", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
  });

  test("is symmetric in argument order", () => {
    const forward = contrastRatio("#1F2328", "#F6F8FA");
    expect(forward).not.toBeNull();
    expect(forward!).toBeCloseTo(contrastRatio("#F6F8FA", "#1F2328")!, 10);
  });

  test("a colour against itself is 1:1", () => {
    expect(contrastRatio("#22D3EE", "#22D3EE")).toBeCloseTo(1, 10);
  });

  test("returns null rather than passing on an unparseable colour", () => {
    // A broken token must fail a contrast assertion loudly. Silently returning 1
    // or Infinity would let a typo'd palette satisfy any threshold.
    expect(contrastRatio("chartreuse", "#FFFFFF")).toBeNull();
    expect(contrastRatio("#FFFFFF", "rgb(1,2,3)")).toBeNull();
  });
});

describe("threshold helpers", () => {
  test("separates the 4.5:1 body-text bar from the 3:1 large-text bar", () => {
    // #808080 on white is 3.95:1 — genuinely between the two thresholds, which
    // is what makes it a usable probe for the gap.
    const ratio = contrastRatio("#808080", "#FFFFFF");
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeGreaterThan(3);
    expect(ratio!).toBeLessThan(4.5);

    expect(meetsLargeTextContrast("#808080", "#FFFFFF")).toBe(true);
    expect(meetsTextContrast("#808080", "#FFFFFF")).toBe(false);

    expect(meetsTextContrast("#000000", "#FFFFFF")).toBe(true);
    expect(meetsLargeTextContrast("#000000", "#FFFFFF")).toBe(true);
  });

  test("an unparseable colour never satisfies a threshold", () => {
    expect(meetsTextContrast("nope", "#FFFFFF")).toBe(false);
    expect(meetsLargeTextContrast("nope", "#FFFFFF")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The palette invariant
// ---------------------------------------------------------------------------

/**
 * Pairs this change is responsible for, at the WCAG AA bar for body text.
 *
 * Each was a hardcoded literal or a missing token before:
 *
 * - `onAccent`/`accent` — thirteen call sites drew near-black `#04111A` on
 *   `colors.accent`. Seven of the eight palettes happen to make that readable;
 *   `dev-light` does not, and `syncTheme` selects `dev-light` automatically on a
 *   device in light mode, so every accent button lost its label.
 * - `text`/`textMuted` on `surfaceElevated` — the two pickers used a `#FFFFFF`
 *   modal, which stranded their themed children on the wrong background.
 */
const OWNED_PAIRS: readonly (readonly [string, string])[] = [
  ["text", "background"],
  ["text", "surface"],
  ["text", "surfaceElevated"],
  ["text", "inputBackground"],
  ["textMuted", "background"],
  ["textMuted", "surface"],
  ["textMuted", "surfaceElevated"],
  ["onAccent", "accent"],
];

/**
 * `accent` is also used for graphics rather than text — the agent colour dot,
 * the spinner, the current-item tick. WCAG 1.4.11 asks for 3:1 there, not 4.5:1.
 */
const ACCENT_GRAPHICS_SURFACES = [
  "background",
  "surface",
  "surfaceElevated",
] as const satisfies readonly (keyof ThemeColors)[];

/**
 * Status tokens are read as *text*, so they get the 4.5:1 bar on every surface.
 *
 * This was previously a `KNOWN_STATUS_FLOORS` list of recorded shortfalls —
 * `danger` sat as low as 2.11:1 on Nord's `surfaceElevated`, which is not a
 * legible error message. The escape hatch is gone: all eight palettes now clear
 * 4.5:1 for `danger`, `success` and `warning` on all three surfaces.
 *
 * The replacements were solved rather than eyeballed — hue held constant in
 * OKLCH, minimum perceptual change subject to the bar — so the palettes keep
 * their identity. Two moved far enough to be worth naming: Solarized's and
 * Nord's canonical reds had no accessible colour at their original lightness,
 * and `#DC322F`/`#BF616A` sit so far below the bar that "brand" and "readable"
 * could not both hold.
 */
const STATUS_TOKENS = [
  "danger",
  "success",
  "warning",
] as const satisfies readonly (keyof ThemeColors)[];

const TEXT_SURFACES = [
  "background",
  "surface",
  "surfaceElevated",
  "inputBackground",
] as const satisfies readonly (keyof ThemeColors)[];

describe.each(themeNames)("palette %s", (name: ThemeName) => {
  const theme = themeDefinitions[name];
  const color = (token: string) => theme.colors[token as keyof ThemeColors];

  test.each(OWNED_PAIRS)(
    "%s is readable on %s (WCAG AA 4.5:1)",
    (foreground, background) => {
      const fg = color(foreground);
      const bg = color(background);
      expect(contrastRatio(fg, bg)).not.toBeNull();
      expect(
        meetsTextContrast(fg, bg),
        `${foreground} (${fg}) on ${background} (${bg}) is ${contrastRatio(
          fg,
          bg,
        )?.toFixed(2)}:1, below the 4.5:1 required for text`,
      ).toBe(true);
    },
  );

  // Generated rather than `test.each`: a readonly string tuple does not satisfy
  // any of bun's `test.each` overloads, and the loop reads the same.
  for (const surface of ACCENT_GRAPHICS_SURFACES) {
    test(`accent is visible as a graphic on ${surface} (3:1)`, () => {
      expect(
        meetsLargeTextContrast(theme.colors.accent, theme.colors[surface]),
        `accent (${theme.colors.accent}) on ${surface} (${theme.colors[surface]}) is ${contrastRatio(
          theme.colors.accent,
          theme.colors[surface],
        )?.toFixed(2)}:1`,
      ).toBe(true);
    });
  }

  test("every colour token is an opaque hex literal", () => {
    // `pillBackground` is intentionally the one exception — it is translucent so
    // content can show through a snackbar. Nothing may be unparseable.
    for (const [token, value] of Object.entries(theme.colors)) {
      if (token === "pillBackground") {
        expect(value).toMatch(/^rgba\(/);
        continue;
      }
      expect(
        parseHexColor(value),
        `${name}.${token} = ${value}`,
      ).not.toBeNull();
    }
  });

  test("accent and onAccent are not the same colour", () => {
    // A palette that set them equal would satisfy every contrast assertion
    // vacuously while rendering an invisible button.
    expect(theme.colors.onAccent).not.toBe(theme.colors.accent);
  });
});

describe("high-contrast theme", () => {
  test("keeps borders at the 3:1 graphics bar", () => {
    // Asserted for this theme alone. The other seven use deliberately subtle
    // dividers (1.35:1 to 1.59:1) — WCAG 1.4.11 exempts borders that are not the
    // only means of identifying a control, and forcing 3:1 everywhere would mean
    // heavy rules on every list row. High Contrast exists to be the exception.
    const colors = themeDefinitions["high-contrast"].colors;
    for (const surface of [
      "background",
      "surface",
      "surfaceElevated",
    ] as const) {
      expect(
        meetsLargeTextContrast(colors.border, colors[surface]),
        `border on ${surface}`,
      ).toBe(true);
    }
  });
});

describe("status colours are readable as text", () => {
  // Generated rather than `test.each`: a readonly string tuple does not satisfy
  // any of bun's `test.each` overloads, and the loop reads the same.
  for (const name of themeNames) {
    const theme = themeDefinitions[name];
    for (const token of STATUS_TOKENS) {
      for (const surface of TEXT_SURFACES) {
        test(`${name} ${token} on ${surface} (4.5:1)`, () => {
          const fg = theme.colors[token];
          const bg = theme.colors[surface];
          expect(
            meetsTextContrast(fg, bg),
            `${name} ${token} (${fg}) on ${surface} (${bg}) is ${contrastRatio(
              fg,
              bg,
            )?.toFixed(
              2,
            )}:1 — §5.4b solved these as minimum-change variants of ` +
              `each hue, so re-solve rather than lowering the bar`,
          ).toBe(true);
        });
      }
    }
  }
});

describe("palette table", () => {
  test("every theme name has a matching definition", () => {
    for (const name of themeNames) {
      expect(themeDefinitions[name]).toBeDefined();
      expect(themeDefinitions[name].name).toBe(name);
    }
  });

  test("there are no definitions outside the declared name list", () => {
    // A palette added to the table but not to `themeNames` would be unreachable
    // from Settings and would silently escape every assertion above.
    expect(Object.keys(themeDefinitions).sort()).toEqual(
      [...themeNames].sort(),
    );
  });

  test("onAccent is white only for the one dark-accented palette", () => {
    // Documented intent: `dev-light` is the only theme whose accent is dark, so
    // it is the only one needing a light foreground. If a future palette ships a
    // dark accent, name it here.
    const whiteForegrounds = themeNames.filter(
      (n) => themeDefinitions[n].colors.onAccent === "#FFFFFF",
    );
    expect(whiteForegrounds).toEqual(["dev-light"]);
  });
});

/** Local alias so the index accesses above stay type-safe. */
type ThemeColors = (typeof themeDefinitions)[ThemeName]["colors"];
