import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import type { TimelineRow } from "../data/queries";
import { FAMILY_ORDER, familyColour, type Theme } from "../theme";
import { PlotFigure } from "./PlotFigure";

/** Every year from first to last (so gaps show as gaps), then "undated" if present. */
function yearDomain(rows: TimelineRow[]): string[] {
  const years = rows.map((r) => Number(r.year)).filter((y) => Number.isInteger(y));
  const all = years.length ? Array.from({ length: Math.max(...years) - Math.min(...years) + 1 }, (_, i) => String(Math.min(...years) + i)) : [];
  return rows.some((r) => r.year === "undated") ? [...all, "undated"] : all;
}

export function Timeline({ rows, theme }: { rows: TimelineRow[]; theme: Theme }) {
  const options = useMemo<Plot.PlotOptions>(
    () => ({
      height: 280,
      marginLeft: 40,
      x: { label: "Collection year", type: "band", domain: yearDomain(rows), tickFormat: (y: string) => (y === "undated" || Number(y) % 5 === 0 ? y : "") },
      // A genome with two carbapenemase families is stacked once per family.
      y: { label: "Genomes per carbapenemase family", grid: true, tickFormat: "d", interval: 1 },
      color: { domain: FAMILY_ORDER, range: FAMILY_ORDER.map((f) => familyColour(f, theme)), legend: true },
      marks: [Plot.barY(rows, { x: "year", y: "isolates", fill: "family", tip: true }), Plot.ruleY([0])],
    }),
    [rows, theme],
  );
  const detections = rows.filter((r) => r.family !== "none").reduce((n, r) => n + r.isolates, 0);
  const groups = new Set(rows.map((r) => r.year)).size;
  return (
    <PlotFigure options={options} summary={`${detections} carbapenemase detections across ${groups} year groups`} />
  );
}
