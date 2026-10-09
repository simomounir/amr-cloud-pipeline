import type { RunFacts } from "./studies";

/** Dollars per analysed genome (total cost over genomes that were analysed), or null when unknown. */
export function costPerGenome(run: Pick<RunFacts, "cost_usd" | "analysed">): number | null {
  return run.cost_usd === null || run.analysed <= 0 ? null : run.cost_usd / run.analysed;
}

/** Dollars to three decimals ("$0.031"), or "n/a" when unknown. */
export const formatDollars = (value: number | null): string => (value === null ? "n/a" : `$${value.toFixed(3)}`);

export const formatCostPerGenome = (run: Pick<RunFacts, "cost_usd" | "analysed">): string =>
  formatDollars(costPerGenome(run));
