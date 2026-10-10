import { expect, test } from "vitest";
import { studyLabel } from "../src/components/Header";
import { carrierShares } from "../src/components/PeriodBars";
import { figureWidth } from "../src/components/PlotFigure";

test("figureWidth follows the container within its bounds", () => {
  expect(figureWidth(900, 320, 760)).toBe(760);
  expect(figureWidth(500, 320, 760)).toBe(500);
  expect(figureWidth(300, 560, 720)).toBe(560); // below minWidth the figure scrolls
});

test("carrierShares adds every combo but none, per clone and period", () => {
  const row = (clone: string, period: string, combo: string, share: number) => ({ clone, period, combo, genomes: 1, share });
  const shares = carrierShares([
    row("ST11", "2013-2017", "KPC", 0.25),
    row("ST11", "2013-2017", "NDM+OXA-48-like", 0.25),
    row("ST11", "2013-2017", "none", 0.5),
    row("ST307", "2013-2017", "none", 1),
  ]);
  expect(shares).toEqual([
    { clone: "ST11", period: "2013-2017", share: 0.5 },
    { clone: "ST307", period: "2013-2017", share: 0 },
  ]);
});

test("studyLabel turns a slug into a short nav label", () => {
  expect(studyLabel("carbapenemase-clones")).toBe("Carbapenemase clones");
  expect(studyLabel("x")).toBe("X");
});
