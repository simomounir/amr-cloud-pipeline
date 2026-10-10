import { expect, test } from "vitest";
import { comboFamily, contrast, distinguishingFamily, drugClassScale, familyColour, inkOn, mix, shareFill, sortCombos } from "../src/theme";

test("comboFamily is the earliest family in FAMILY_ORDER that the combo contains", () => {
  expect(comboFamily("KPC")).toBe("KPC");
  expect(comboFamily("OXA-48-like+NDM")).toBe("NDM");
  expect(comboFamily("VIM+IMP")).toBe("VIM");
  expect(comboFamily("none")).toBe("none");
});

test("comboFamily files a combo of unknown families under other", () => {
  expect(comboFamily("GES")).toBe("other");
  expect(comboFamily("GES+SME")).toBe("other");
  expect(comboFamily("GES+NDM")).toBe("NDM");
});

test("sortCombos orders by FAMILY_ORDER rank, a single before its multi-family combos", () => {
  expect(sortCombos(["VIM", "NDM+OXA-48-like", "KPC", "NDM", "none", "OXA-48-like", "IMP"])).toEqual([
    "KPC",
    "NDM",
    "NDM+OXA-48-like",
    "OXA-48-like",
    "VIM",
    "IMP",
    "none",
  ]);
});

test("sortCombos ties are alphabetical and duplicates are dropped", () => {
  expect(sortCombos(["NDM+VIM", "NDM+IMP", "NDM+VIM"])).toEqual(["NDM+VIM", "NDM+IMP"]);
  expect(sortCombos(["b-other", "a-other"])).toEqual(["a-other", "b-other"]);
});

test("sortCombos ranks an unknown family as other", () => {
  expect(sortCombos(["none", "GES", "IMP", "other", "KPC"])).toEqual(["KPC", "IMP", "GES", "other", "none"]);
});

test("distinguishingFamily outlines only multi-family combos that share a first family with another", () => {
  const combos = ["NDM", "NDM+OXA-48-like", "NDM+VIM", "KPC+VIM"];
  expect(distinguishingFamily("NDM+OXA-48-like", combos)).toBe("OXA-48-like");
  expect(distinguishingFamily("NDM+VIM", combos)).toBe("VIM");
  expect(distinguishingFamily("NDM", combos)).toBeNull();
  expect(distinguishingFamily("KPC+VIM", combos)).toBeNull();
});

test("drugClassScale gives each drug class a fixed colour, whatever its rank, and folds rare ones into Other", () => {
  const a = drugClassScale(["AMINOGLYCOSIDE", "BETA-LACTAM"], "light");
  const b = drugClassScale(["BETA-LACTAM", "QUINOLONE", "AMINOGLYCOSIDE"], "light");
  const colour = (s: ReturnType<typeof drugClassScale>, c: string) => s.range[s.domain.indexOf(c)];
  expect(colour(a, "AMINOGLYCOSIDE")).toBe(colour(b, "AMINOGLYCOSIDE"));
  expect(colour(a, "BETA-LACTAM")).toBe("#2a78d6");
  expect(colour(drugClassScale(["BETA-LACTAM"], "dark"), "BETA-LACTAM")).toBe("#3987e5");
  const rare = drugClassScale(["BETA-LACTAM", "BLEOMYCIN", "FOSFOMYCIN"], "light");
  expect(rare.domain).toEqual(["BETA-LACTAM", "Other"]);
  expect(rare.fold("BLEOMYCIN")).toBe("Other");
  expect(rare.fold("BETA-LACTAM")).toBe("BETA-LACTAM");
});

test("mix blends in sRGB from one colour to the other", () => {
  expect(mix("#000000", "#ffffff", 0)).toBe("#000000");
  expect(mix("#000000", "#ffffff", 1)).toBe("#ffffff");
  expect(mix("#000000", "#ff8000", 0.5)).toBe("#804000");
});

test("shareFill reaches the family colour at 100% and stays near the surface at 0%", () => {
  expect(shareFill("KPC", 1, "light")).toBe(familyColour("KPC", "light").toLowerCase());
  expect(contrast(shareFill("KPC", 0, "light"), "#ffffff")).toBeLessThan(1.1);
  expect(contrast(shareFill("NDM", 0, "dark"), "#161c23")).toBeLessThan(1.1);
});

// Mid-tone fills cap what black or white text can reach (about 4.6:1 at best), so the floor is 4.3.
test("inkOn keeps every heatmap cell's text readable, in both modes", () => {
  for (const theme of ["light", "dark"] as const) {
    for (const family of ["KPC", "NDM", "OXA-48-like", "VIM", "IMP", "other", "none"]) {
      for (let share = 0; share <= 1; share += 0.01) {
        const fill = shareFill(family, share, theme);
        expect(contrast(fill, inkOn(fill)), `${theme} ${family} ${share}`).toBeGreaterThanOrEqual(4.3);
      }
    }
  }
});
