import * as Plot from "@observablehq/plot";
import { useCallback, useMemo } from "react";
import type { MixRow } from "../data/queries";
import { PERIOD_ORDER, comboFamily, distinguishingFamily, familyColour, sortCombos, type Theme } from "../theme";
import { PlotFigure } from "./PlotFigure";

const isMulti = (combo: string) => combo.includes("+");

const SHORT_PERIOD: Record<string, string> = { "2012 or earlier": "to 2012", "2013-2017": "2013–17", "2018 or later": "2018 on" };

/** Below this width the clones stack (one row of bars each) instead of sitting side by side. */
const NARROW = 560;

interface Carriers {
  clone: string;
  period: string;
  share: number;
}

/** Per clone and period, the share of genomes that carry any carbapenemase (everything but "none"). */
export function carrierShares(rows: MixRow[]): Carriers[] {
  const sums = new Map<string, Carriers>();
  for (const r of rows) {
    const key = `${r.clone}|${r.period}`;
    const entry = sums.get(key) ?? { clone: r.clone, period: r.period, share: 0 };
    if (r.combo !== "none") entry.share += r.share;
    sums.set(key, entry);
  }
  return [...sums.values()];
}

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
  const options = useMemo(() => {
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
    const carriers = carrierShares(rows);
    return (width: number): Plot.PlotOptions => {
      const narrow = width < NARROW;
      // Wide: one panel per clone, side by side. Narrow: the panels stack, each a row of three bars.
      const facet = narrow ? { fy: "clone" } : { fx: "clone" };
      const periodWidth = narrow ? width - 60 : (width - 60) / Math.max(1, clones.length);
      const rotate = periodWidth < 270;
      return {
        height: narrow ? clones.length * 250 : 420,
        marginTop: 56,
        marginBottom: narrow ? 28 : rotate ? 70 : 36,
        marginLeft: 48,
        marginRight: narrow ? 70 : 0,
        // Clone names are drawn as text above each panel (below), clear of the carrier numbers.
        fx: { domain: clones, axis: null, padding: 0.12 },
        fy: { domain: clones, axis: null, padding: 0.35 },
        // Stacked panels each get their own period axis, in short form so it fits a phone.
        x: { domain: PERIOD_ORDER, label: null, tickRotate: rotate ? -35 : 0, padding: 0.25, ...(narrow ? { axis: null } : {}) },
        y: { percent: true, label: "% of genomes", grid: true, ticks: narrow ? 3 : 5 },
        color: { domain: combos, range: combos.map((c) => familyColour(comboFamily(c), theme)) },
        style: { overflow: "visible" },
        marks: [
          Plot.barY(
            rows,
            Plot.stackY({ order: combos }, {
              ...facet,
              x: "period",
              y: "share",
              fill: "combo",
              fillOpacity: (d: MixRow) => (isMulti(d.combo) ? 0.55 : 1) * (hasSelection && !isSelected(d) ? 0.35 : 1),
              stroke: (d: MixRow) => (isSelected(d) ? "var(--ink)" : outline(d.combo)),
              strokeOpacity: (d: MixRow) => (isMulti(d.combo) ? 0.55 : 1) * (hasSelection && !isSelected(d) ? 0.35 : 1),
              strokeWidth: (d: MixRow) => (isSelected(d) ? 3 : distinguishingFamily(d.combo, combos) === null ? 2 : 1.5),
              ariaLabel: (d: MixRow) => `${d.clone} ${d.period} ${d.combo}`,
              title: (d: MixRow) => `${d.clone}, ${d.period}\n${d.combo}: ${d.genomes} genomes (${Math.round(d.share * 100)}%)`,
              tip: true,
            }),
          ),
          Plot.ruleY([0]),
          ...(narrow ? [Plot.axisX({ facetAnchor: null, tickSize: 0, tickFormat: (p: string) => SHORT_PERIOD[p] ?? p })] : []),
          Plot.text(clones, {
            [narrow ? "fy" : "fx"]: (d: string) => d,
            frameAnchor: narrow ? "top-left" : "top",
            dy: -36,
            text: (d: string) => d,
            fill: "var(--ink)",
            fontWeight: 700,
            fontSize: 14,
            pointerEvents: "none",
          }),
          // The number above each bar: how many of its genomes carry a carbapenemase at all.
          Plot.text(carriers, {
            ...facet,
            x: "period",
            y: 1,
            dy: -10,
            text: (d: Carriers) => `${Math.round(d.share * 100)}%`,
            fill: "var(--ink)",
            fontWeight: 600,
            fontSize: 13,
            pointerEvents: "none",
          }),
        ],
      } as Plot.PlotOptions;
    };
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
