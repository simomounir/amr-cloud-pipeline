import type { RunFacts } from "./studies";

/** Dollars per analysed genome (total cost over genomes that were analysed), or null when unknown. */
export function costPerGenome(run: Pick<RunFacts, "cost_usd" | "analysed">): number | null {
  return run.cost_usd === null || run.analysed <= 0 ? null : run.cost_usd / run.analysed;
}

/** Dollars to three decimals ("$0.031"), or "n/a" when unknown. */
export const formatDollars = (value: number | null): string => (value === null ? "n/a" : `$${value.toFixed(3)}`);

export const formatCostPerGenome = (run: Pick<RunFacts, "cost_usd" | "analysed">): string =>
  formatDollars(costPerGenome(run));

/** The map figure's caption: genomes shown, how many have no country, and where countries come from. */
export function mapCaption(mapped: number, noCountry: number): string {
  const unmapped =
    noCountry === 1
      ? "1 genome has no country in its ENA record and is not mapped"
      : `${noCountry} genomes have no country in their ENA record and are not mapped`;
  return `n = ${mapped + noCountry} genomes; ${unmapped}. Dot area shows the number of genomes. Country as recorded in ENA; the source table assigns countries to all genomes.`;
}

/** Heatmap tooltip for one clone x family (x period) cell. */
export function heatCellTitle(c: { clone: string; period: string; family: string; carriers: number; genomes: number }): string {
  if (c.genomes === 0) return `${c.clone}: no genomes in ${c.period === "all" ? "this selection" : c.period}`;
  return `${c.clone}: ${c.carriers} of ${c.genomes} genomes carry ${c.family}`;
}
