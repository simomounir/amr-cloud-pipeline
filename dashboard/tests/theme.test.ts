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

test("drugClassScale gives each class a palette slot per theme and folds the ones past the eighth into Other", () => {
  const few = drugClassScale(["BETA-LACTAM", "AMINOGLYCOSIDE", "BETA-LACTAM"], "light");
  expect(few.domain).toEqual(["BETA-LACTAM", "AMINOGLYCOSIDE"]);
  expect(few.range).toEqual(["#2a78d6", "#eb6834"]);
  expect(drugClassScale(["A"], "dark").range).toEqual(["#3987e5"]);
  const many = drugClassScale(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"], "dark");
  expect(many.domain).toEqual(["a", "b", "c", "d", "e", "f", "g", "h", "Other"]);
  expect(many.range).toHaveLength(9);
  expect(many.fold("i")).toBe("Other");
  expect(many.fold("h")).toBe("h");
});
