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
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      try {
        window.localStorage.setItem(KEY, next);
      } catch {
        // not persisted; the choice still applies for this visit
      }
      return next;
    });
  }, []);
  return { theme, toggle };
}
