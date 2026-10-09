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
