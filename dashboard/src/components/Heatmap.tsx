import * as Plot from "@observablehq/plot";
import { useCallback, useMemo } from "react";
import type { HeatCell } from "../data/queries";
import { FAMILY_ORDER, PERIOD_ORDER, SEQUENTIAL, type Theme } from "../theme";
import { PlotFigure } from "./PlotFigure";

interface Cell extends HeatCell {
  label: string;
}

/** Every clone x family (x period) pair, so a missing pair shows as an empty 0% cell. */
function fill(cells: HeatCell[], byPeriod: boolean): { rows: Cell[]; clones: string[] } {
  const clones = [...new Set(cells.map((c) => c.clone))].sort();
  const periods = byPeriod ? PERIOD_ORDER.filter((p) => cells.some((c) => c.period === p)) : [cells[0]?.period ?? "all"];
  const key = (clone: string, period: string, family: string) => `${clone}|${period}|${family}`;
  const have = new Map(cells.map((c) => [key(c.clone, c.period, c.family), c]));
  const genomes = new Map(cells.map((c) => [`${c.clone}|${c.period}`, c.genomes]));
  const rows = clones.flatMap((clone) =>
    periods.flatMap((period) =>
      FAMILY_ORDER.map((family): Cell => {
        const c = have.get(key(clone, period, family)) ?? {
          clone, period, family, genomes: genomes.get(`${clone}|${period}`) ?? 0, carriers: 0, share: 0,
        };
        return { ...c, label: `${clone} ${family} ${Math.round(c.share * 100)}%` };
      }),
    ),
  );
  return { rows, clones };
}

export function Heatmap({
  cells,
  selected,
  byPeriod,
  onByPeriod,
  onPick,
  theme,
}: {
  cells: HeatCell[];
  selected: { clone?: string; family?: string };
  byPeriod: boolean;
  onByPeriod: (byPeriod: boolean) => void;
  onPick: (clone: string, family: string) => void;
  theme: Theme;
}) {
  const options = useMemo<Plot.PlotOptions>(() => {
    const { rows, clones } = fill(cells, byPeriod);
    const hasSelection = selected.clone !== undefined || selected.family !== undefined;
    const isSelected = (d: Cell) =>
      (selected.clone === undefined || d.clone === selected.clone) && (selected.family === undefined || d.family === selected.family) && hasSelection;
    // Text sits on the ramp: light-to-dark in light mode, dark-to-light in dark mode.
    const textColour = (d: Cell) => (d.share > 0.5 ? (theme === "light" ? "#ffffff" : "#0f1419") : "var(--ink)");
    const facet = byPeriod ? { fx: "period" } : {};
    return {
      marginLeft: 90,
      marginBottom: 70,
      height: 100 + clones.length * 34,
      x: { domain: FAMILY_ORDER, label: null, tickRotate: -35 },
      y: { domain: clones, label: null },
      fx: { domain: PERIOD_ORDER, label: null },
      color: { type: "linear", domain: [0, 1], range: SEQUENTIAL[theme], legend: true, label: "Share of genomes", tickFormat: "%" },
      marks: [
        Plot.cell(rows, {
          ...facet,
          x: "family",
          y: "clone",
          fill: "share",
          fillOpacity: (d: Cell) => (hasSelection && !isSelected(d) ? 0.35 : 1),
          stroke: (d: Cell) => (isSelected(d) ? "var(--ink)" : "var(--line)"),
          strokeWidth: (d: Cell) => (isSelected(d) ? 2 : 0.5),
          ariaLabel: "label",
          title: (d: Cell) => `${d.clone}: ${d.carriers} of ${d.genomes} genomes carry ${d.family}`,
          tip: true,
        }),
        Plot.text(rows, { ...facet, x: "family", y: "clone", text: (d: Cell) => `${Math.round(d.share * 100)}%`, fill: textColour, pointerEvents: "none" }),
      ],
    } as Plot.PlotOptions;
  }, [cells, selected.clone, selected.family, byPeriod, theme]);
  const pick = useCallback((d: unknown) => onPick((d as HeatCell).clone, (d as HeatCell).family), [onPick]);
  return (
    <>
      <button className="chip" aria-pressed={byPeriod} onClick={() => onByPeriod(!byPeriod)}>
        {byPeriod ? "All periods" : "By period"}
      </button>
      <PlotFigure options={options} summary={`Carbapenemase family share for ${new Set(cells.map((c) => c.clone)).size} clones`} onPick={pick} />
    </>
  );
}
