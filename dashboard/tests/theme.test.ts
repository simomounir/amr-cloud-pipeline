import { expect, test } from "vitest";
import { comboFamily, distinguishingFamily, drugClassScale, sortCombos } from "../src/theme";

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
