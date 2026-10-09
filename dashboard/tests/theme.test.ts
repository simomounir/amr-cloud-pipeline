import { expect, test } from "vitest";
import { comboFamily, sortCombos } from "../src/theme";

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
