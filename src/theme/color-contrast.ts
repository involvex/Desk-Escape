/**
 * WCAG 2.1 relative luminance and contrast ratio.
 *
 * Exists because the theme palettes are hand-written, and the failure mode is
 * invisible until you look at the screen: a hardcoded near-black label on a
 * theme's `accent` reads as correct on seven of the eight palettes and vanishes
 * on the eighth. Nothing in the type system or the linter catches that, so it is
 * computed here and asserted in `__tests__/theme-contrast.test.ts` instead.
 *
 * Kept dependency-free and pure so it can be tested without React Native.
 */

/**
 * Parses `#RGB` or `#RRGGBB`. Returns null for anything else.
 *
 * Eight-digit hex is rejected rather than accepted-with-alpha-stripped. WCAG is
 * defined over opaque colours, so accepting `#RRGGBBAA` would mean silently
 * guessing at what the caller meant, and a caller that got it wrong would get a
 * confident wrong answer. The palettes express translucency with `rgba(...)`
 * instead — `pillBackground` is the only such token, and it is never a contrast
 * target.
 */
export function parseHexColor(value: string): [number, number, number] | null {
  const hex = value.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null;

  // `#RGB` shorthand expands each nibble, so `#fff` means `#ffffff`.
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((char) => char + char)
          .join("")
      : hex;

  if (full.length !== 6) return null;

  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** One sRGB channel in 0..255, linearised per WCAG 2.1. */
function linearize(channel: number): number {
  const value = channel / 255;
  return value <= 0.03928
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4);
}

/**
 * WCAG relative luminance.
 *
 * Uses the sRGB transfer function rather than a straight gamma 2.2
 * approximation; the two disagree by more than a full point of contrast in the
 * mid-tones, which is enough to flip a borderline pair either way.
 *
 * Channels are linearised one at a time rather than with `.map()`, because map
 * over a tuple widens it to `number[]` and the destructured elements stop being
 * known to be defined.
 */
export function relativeLuminance(rgb: [number, number, number]): number {
  return (
    0.2126 * linearize(rgb[0]) +
    0.7152 * linearize(rgb[1]) +
    0.0722 * linearize(rgb[2])
  );
}

/**
 * Contrast ratio between two opaque colours, from 1 to 21.
 *
 * Returns `null` if either colour cannot be parsed, so an unparseable value is a
 * test failure rather than a silent pass — a broken token should not be able to
 * satisfy a contrast assertion by accident.
 */
export function contrastRatio(
  foreground: string,
  background: string,
): number | null {
  const fg = parseHexColor(foreground);
  const bg = parseHexColor(background);
  if (!fg || !bg) return null;

  const lighter = Math.max(relativeLuminance(fg), relativeLuminance(bg));
  const darker = Math.min(relativeLuminance(fg), relativeLuminance(bg));
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AA for body text (4.5:1). Fails loudly on an unparseable colour. */
export function meetsTextContrast(
  foreground: string,
  background: string,
): boolean {
  const ratio = contrastRatio(foreground, background);
  return ratio !== null && ratio >= 4.5;
}

/** WCAG AA for large text and UI graphics (3:1). */
export function meetsLargeTextContrast(
  foreground: string,
  background: string,
): boolean {
  const ratio = contrastRatio(foreground, background);
  return ratio !== null && ratio >= 3;
}
