import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

export const FAMILY_ORDER = ["KPC", "NDM", "OXA-48-like", "VIM", "IMP", "other", "none"];
export const PERIOD_ORDER = ["2012 or earlier", "2013-2017", "2018 or later"];

// Okabe-Ito. The dark steps for OXA-48-like, IMP and other are re-stepped into the dark lightness
// band (validate_palette.js --mode dark); `none` is a neutral, not a category hue.
const LIGHT: Record<string, string> = {
  KPC: "#D55E00", NDM: "#0072B2", "OXA-48-like": "#E69F00", VIM: "#009E73", IMP: "#CC79A7", other: "#56B4E9", none: "#BBBBBB",
};
const DARK: Record<string, string> = {
  KPC: "#D55E00", NDM: "#0072B2", "OXA-48-like": "#C28500", VIM: "#009E73", IMP: "#CF6FA6", other: "#3596CA", none: "#5d6877",
};

export function familyColour(family: string, theme: Theme = "light"): string {
  return (theme === "dark" ? DARK : LIGHT)[family] ?? (theme === "dark" ? DARK.none : LIGHT.none);
}

// Drug classes: the documented 8-slot categorical palette (validate_palette.js, adjacent pairs, both modes:
// all checks pass; three light slots are under 3:1 on the surface, relieved by the value labels on the bars).
// More classes than slots fold into "Other", drawn in the muted neutral.
const CATEGORICAL: Record<Theme, string[]> = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};
export const OTHER_CLASS = "Other";
const OTHER_COLOUR = "#898781"; // the palette's muted neutral, same in both modes

/** Legend order and colours for drug classes given most-common first; classes past the 8th become "Other". */
export function drugClassScale(classes: string[], theme: Theme): { domain: string[]; range: string[]; fold: (c: string) => string } {
  const palette = CATEGORICAL[theme];
  const named = [...new Set(classes)];
  const kept = named.length > palette.length ? named.slice(0, palette.length) : named;
  const folded = named.length > kept.length;
  return {
    domain: folded ? [...kept, OTHER_CLASS] : kept,
    range: folded ? [...palette.slice(0, kept.length), OTHER_COLOUR] : palette.slice(0, kept.length),
    fold: (c) => (kept.includes(c) ? c : OTHER_CLASS),
  };
}

// The heatmap's one-hue ramp (low -> high share), per mode. Only the ends are used as range; checked
// with validate_palette.js (its categorical band/chroma checks do not apply to a ramp; lightness is
// monotonic and the ends are far apart, dE ~52). Cells carry their % as text, so contrast of the
// low end against the surface is relieved by labels, cell outlines and the table view.
export const SEQUENTIAL: Record<Theme, [string, string]> = {
  light: ["#eef4fb", "#0b4f94"],
  dark: ["#1b2630", "#7cc0ff"],
};

/** The earliest family (in FAMILY_ORDER) that a carbapenemase combo such as "IMP+VIM" contains. */
export function comboFamily(combo: string): string {
  const parts = combo.split("+");
  return FAMILY_ORDER.find((f) => parts.includes(f)) ?? "other";
}

/**
 * For a multi-family combo that shares its first family with another multi-family combo in `combos`
 * (same fill, indistinguishable), the family to outline it in: its next family in FAMILY_ORDER. Else null.
 */
export function distinguishingFamily(combo: string, combos: string[]): string | null {
  const order = (c: string) =>
    c
      .split("+")
      .map((f) => (FAMILY_ORDER.includes(f) ? f : "other"))
      .sort((a, b) => FAMILY_ORDER.indexOf(a) - FAMILY_ORDER.indexOf(b));
  const parts = order(combo);
  if (parts.length < 2) return null;
  const shared = combos.some((c) => c !== combo && order(c).length > 1 && comboFamily(c) === comboFamily(combo));
  return shared ? parts.find((f) => f !== comboFamily(combo)) ?? null : null;
}

/** Combos sorted by their families in FAMILY_ORDER (single before multi within a family). */
export function sortCombos(combos: Iterable<string>): string[] {
  const other = FAMILY_ORDER.indexOf("other");
  const position = (f: string) => (FAMILY_ORDER.includes(f) ? FAMILY_ORDER.indexOf(f) : other); // as comboFamily
  const rank = (c: string) => c.split("+").map(position).sort((a, b) => a - b);
  return [...new Set(combos)].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    for (let i = 0; i < Math.max(ra.length, rb.length); i++) {
      if ((ra[i] ?? -1) !== (rb[i] ?? -1)) return (ra[i] ?? -1) - (rb[i] ?? -1);
    }
    return a.localeCompare(b);
  });
}

const KEY = "amr-theme";

function initial(): Theme {
  try {
    const stored = window.localStorage.getItem(KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // storage blocked: fall through to the system preference
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useTheme(): { theme: Theme; toggle(): void } {
  const [theme, setTheme] = useState<Theme>(initial);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const toggle = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // not persisted; the choice still applies for this visit
    }
    setTheme(next);
  }, [theme]);
  return { theme, toggle };
}
