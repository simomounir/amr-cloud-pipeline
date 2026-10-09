import * as Plot from "@observablehq/plot";
import { useCallback, useMemo } from "react";
import type { MixRow } from "../data/queries";
import { PERIOD_ORDER, comboFamily, distinguishingFamily, familyColour, sortCombos, type Theme } from "../theme";
import { PlotFigure } from "./PlotFigure";

const isMulti = (combo: string) => combo.includes("+");

export interface PeriodSelection {
  clones: string[];
  periods: string[];
  combos: string[];
  /** Carbapenemase families picked elsewhere (the heatmap): only segments whose combo contains one stay highlighted. */
  families?: string[];
}

export function PeriodBars({
  rows,
  selected,
  onPick,
  theme,
}: {
  rows: MixRow[];
  /** The current selection: matching segments are outlined, the others dimmed. */
  selected: PeriodSelection;
  onPick: (clone: string, period: string, combo: string) => void;
  theme: Theme;
}) {
  const combos = useMemo(() => sortCombos(rows.map((r) => r.combo)), [rows]);
  const clones = useMemo(() => [...new Set(rows.map((r) => r.clone))].sort(), [rows]);
  const options = useMemo<Plot.PlotOptions>(() => {
    const has = (list: string[], v: string) => list.length === 0 || list.includes(v);
    const families = selected.families ?? [];
    const hasSelection = selected.clones.length + selected.periods.length + selected.combos.length + families.length > 0;
    const hasFamily = (combo: string) => families.length === 0 || combo.split("+").some((f) => families.includes(f));
    const isSelected = (d: MixRow) =>
      hasSelection && has(selected.clones, d.clone) && has(selected.periods, d.period) && has(selected.combos, d.combo) && hasFamily(d.combo);
    // Combos with the same first family look alike; their outline takes the second family's colour.
    const outline = (combo: string) => {
      const family = distinguishingFamily(combo, combos);
      return family === null ? "var(--surface)" : familyColour(family, theme);
    };
    return {
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
              fillOpacity: (d: MixRow) => (isMulti(d.combo) ? 0.55 : 1) * (hasSelection && !isSelected(d) ? 0.35 : 1),
              stroke: (d: MixRow) => (isSelected(d) ? "var(--ink)" : outline(d.combo)),
              strokeWidth: (d: MixRow) => (isSelected(d) ? 3 : distinguishingFamily(d.combo, combos) === null ? 2 : 1.5),
              ariaLabel: (d: MixRow) => `${d.clone} ${d.period} ${d.combo}`,
              title: (d: MixRow) => `${d.clone}, ${d.period}\n${d.combo}: ${d.genomes} genomes (${Math.round(d.share * 100)}%)`,
              tip: true,
            }),
          ),
          Plot.ruleY([0]),
        ],
    } as Plot.PlotOptions;
  }, [rows, clones, combos, selected, theme]);
  const pick = useCallback((d: unknown) => onPick((d as MixRow).clone, (d as MixRow).period, (d as MixRow).combo), [onPick]);
  return (
    <>
      <ul className="legend" aria-label="Carbapenemase combinations">
        {combos.map((c) => (
          <li key={c}>
            <span className="swatch" aria-hidden="true">
              <span className="swatch-fill" style={{ background: familyColour(comboFamily(c), theme), opacity: isMulti(c) ? 0.55 : 1 }} />
              {distinguishingFamily(c, combos) !== null && (
                <span className="swatch-ring" style={{ borderColor: familyColour(distinguishingFamily(c, combos) as string, theme) }} />
              )}
            </span>
            {c}
          </li>
        ))}
      </ul>
      <PlotFigure options={options} summary={`Carbapenemase mix by period for ${clones.length} clones`} onPick={pick} />
    </>
  );
}
