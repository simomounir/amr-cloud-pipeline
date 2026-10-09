import { expect, it } from "vitest";
import { costPerGenome, formatCostPerGenome, heatCellTitle, mapCaption } from "../src/data/format";

it("cost per genome is cost over analysed genomes, to 3 decimals", () => {
  expect(formatCostPerGenome({ cost_usd: 4.76, analysed: 152 })).toBe("$0.031");
  expect(costPerGenome({ cost_usd: 4.76, analysed: 152 })).toBeCloseTo(0.0313, 4);
});
it("is n/a without a cost or without analysed genomes", () => {
  expect(formatCostPerGenome({ cost_usd: null, analysed: 152 })).toBe("n/a");
  expect(formatCostPerGenome({ cost_usd: 4.76, analysed: 0 })).toBe("n/a");
  expect(costPerGenome({ cost_usd: null, analysed: 3 })).toBeNull();
});

it("the map caption agrees in number", () => {
  expect(mapCaption(5, 1)).toContain("n = 6 genomes; 1 genome has no country in its ENA record and is not mapped.");
  expect(mapCaption(5, 2)).toContain("n = 7 genomes; 2 genomes have no country in their ENA record and are not mapped.");
  expect(mapCaption(5, 0)).toContain("0 genomes have no country");
});
it("an empty heatmap cell says there are no genomes, not '0 of 0'", () => {
  const cell = { clone: "ST11", period: "2018 or later", family: "KPC", carriers: 0, genomes: 0 };
  expect(heatCellTitle(cell)).toBe("ST11: no genomes in 2018 or later");
  expect(heatCellTitle({ ...cell, period: "all" })).toBe("ST11: no genomes in this selection");
  expect(heatCellTitle({ ...cell, genomes: 4, carriers: 3 })).toBe("ST11: 3 of 4 genomes carry KPC");
});
