import * as Plot from "@observablehq/plot";
import { useCallback, useMemo } from "react";
import { heatCellTitle } from "../data/format";
import type { HeatCell } from "../data/queries";
import { FAMILY_ORDER, PERIOD_ORDER, inkOn, shareFill, type Theme } from "../theme";
import { PlotFigure } from "./PlotFigure";

interface Cell extends HeatCell {
  label: string;
  colour: string;
}

/** Below this width the grid turns: clones become the columns and families the rows, periods stack. */
const NARROW = 560;

/** Every clone x family (x period) pair, so a missing pair shows as an empty 0% cell. */
function fill(cells: HeatCell[], byPeriod: boolean, theme: Theme): { rows: Cell[]; clones: string[]; periods: string[] } {
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
        return { ...c, label: `${clone} ${family} ${Math.round(c.share * 100)}%`, colour: shareFill(family, c.share, theme) };
      }),
    ),
  );
  return { rows, clones, periods };
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
  const options = useMemo(() => {
    const { rows, clones, periods } = fill(cells, byPeriod, theme);
    const hasSelection = selected.clone !== undefined || selected.family !== undefined;
    const isSelected = (d: Cell) =>
      (selected.clone === undefined || d.clone === selected.clone) && (selected.family === undefined || d.family === selected.family) && hasSelection;
    const cellText = (d: Cell) => `${Math.round(d.share * 100)}%`;
    return (width: number): Plot.PlotOptions => {
      const narrow = width < NARROW;
      // Wide: families across, clones down, periods side by side. Narrow: clones across, families down, periods stacked.
      const position = narrow
        ? { x: "clone", y: "family", ...(byPeriod ? { fy: "period" } : {}) }
        : { x: "family", y: "clone", ...(byPeriod ? { fx: "period" } : {}) };
      const rowCount = narrow ? FAMILY_ORDER.length * periods.length : clones.length;
      const rotate = !narrow && byPeriod;
      return {
        marginLeft: 90,
        marginRight: narrow && byPeriod ? 24 : 0,
        marginBottom: rotate ? 70 : 32,
        height: 50 + rowCount * (narrow ? 32 : 44) + (rotate ? 40 : 0),
        x: { domain: narrow ? clones : FAMILY_ORDER, label: null, tickRotate: rotate ? -35 : 0, tickSize: 0 },
        y: { domain: narrow ? FAMILY_ORDER : clones, label: null, tickSize: 0 },
        fx: { domain: PERIOD_ORDER.filter((p) => periods.includes(p)), label: null },
        fy: { domain: PERIOD_ORDER.filter((p) => periods.includes(p)), label: null },
        marks: [
          Plot.cell(rows, {
            ...position,
            fill: "colour",
            fillOpacity: (d: Cell) => (hasSelection && !isSelected(d) ? 0.35 : 1),
            stroke: (d: Cell) => (isSelected(d) ? "var(--ink)" : "var(--surface)"),
            strokeWidth: (d: Cell) => (isSelected(d) ? 2.5 : 2),
            inset: 0.5,
            ariaLabel: "label",
            title: heatCellTitle,
            tip: true,
          }),
          Plot.text(rows, {
            ...position,
            text: cellText,
            fill: (d: Cell) => inkOn(d.colour),
            fillOpacity: (d: Cell) => (hasSelection && !isSelected(d) ? 0.5 : 1),
            fontWeight: 600,
            pointerEvents: "none",
          }),
        ],
      } as Plot.PlotOptions;
    };
  }, [cells, selected.clone, selected.family, byPeriod, theme]);
  const pick = useCallback((d: unknown) => onPick((d as HeatCell).clone, (d as HeatCell).family), [onPick]);
  return (
    <>
      <div className="segmented" role="group" aria-label="Periods">
        <button aria-pressed={!byPeriod} onClick={() => onByPeriod(false)}>
          All periods
        </button>
        <button aria-pressed={byPeriod} onClick={() => onByPeriod(true)}>
          By period
        </button>
      </div>
      <PlotFigure
        options={options}
        maxWidth={byPeriod ? 1280 : 760}
        summary={`Carbapenemase family share for ${new Set(cells.map((c) => c.clone)).size} clones`}
        onPick={pick}
      />
    </>
  );
}
