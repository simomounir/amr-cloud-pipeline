import * as Plot from "@observablehq/plot";
import { useCallback, useMemo } from "react";
import type { MixRow } from "../data/queries";
import { PERIOD_ORDER, comboFamily, familyColour, sortCombos, type Theme } from "../theme";
import { PlotFigure } from "./PlotFigure";

const isMulti = (combo: string) => combo.includes("+");

export function PeriodBars({ rows, onPick, theme }: { rows: MixRow[]; onPick: (clone: string, period: string, combo: string) => void; theme: Theme }) {
  const combos = useMemo(() => sortCombos(rows.map((r) => r.combo)), [rows]);
  const clones = useMemo(() => [...new Set(rows.map((r) => r.clone))].sort(), [rows]);
  const options = useMemo<Plot.PlotOptions>(
    () =>
      ({
        height: 360,
        marginBottom: 70,
        marginLeft: 48,
        fx: { domain: clones, label: null },
        x: { domain: PERIOD_ORDER, label: null, tickRotate: -35 },
        y: { percent: true, label: "% of genomes", grid: true },
        color: { domain: combos, range: combos.map((c) => familyColour(comboFamily(c), theme)) },
        marks: [
          Plot.barY(
            rows,
            Plot.stackY({ order: combos }, {
              fx: "clone",
              x: "period",
              y: "share",
              fill: "combo",
              fillOpacity: (d: MixRow) => (isMulti(d.combo) ? 0.55 : 1),
              stroke: "var(--surface)",
              strokeWidth: 2,
              ariaLabel: (d: MixRow) => `${d.clone} ${d.period} ${d.combo}`,
              title: (d: MixRow) => `${d.clone}, ${d.period}\n${d.combo}: ${d.genomes} genomes (${Math.round(d.share * 100)}%)`,
              tip: true,
            }),
          ),
          Plot.ruleY([0]),
        ],
      }) as Plot.PlotOptions,
    [rows, clones, combos, theme],
  );
  const pick = useCallback((d: unknown) => onPick((d as MixRow).clone, (d as MixRow).period, (d as MixRow).combo), [onPick]);
  return (
    <>
      <ul className="legend" aria-label="Carbapenemase combinations">
        {combos.map((c) => (
          <li key={c}>
            <span className="swatch" style={{ background: familyColour(comboFamily(c), theme), opacity: isMulti(c) ? 0.55 : 1 }} aria-hidden="true" />
            {c}
          </li>
        ))}
      </ul>
      <PlotFigure options={options} summary={`Carbapenemase mix by period for ${clones.length} clones`} onPick={pick} />
    </>
  );
}
