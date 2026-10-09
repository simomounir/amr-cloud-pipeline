import { expect, it } from "vitest";
import { costPerGenome, formatCostPerGenome } from "../src/data/format";

it("cost per genome is cost over analysed genomes, to 3 decimals", () => {
  expect(formatCostPerGenome({ cost_usd: 4.76, analysed: 152 })).toBe("$0.031");
  expect(costPerGenome({ cost_usd: 4.76, analysed: 152 })).toBeCloseTo(0.0313, 4);
});
it("is n/a without a cost or without analysed genomes", () => {
  expect(formatCostPerGenome({ cost_usd: null, analysed: 152 })).toBe("n/a");
  expect(formatCostPerGenome({ cost_usd: 4.76, analysed: 0 })).toBe("n/a");
  expect(costPerGenome({ cost_usd: null, analysed: 3 })).toBeNull();
});
