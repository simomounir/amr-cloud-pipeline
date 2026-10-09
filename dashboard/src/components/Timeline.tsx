import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import type { TimelineRow } from "../data/queries";
import { FAMILY_ORDER, familyColour, type Theme } from "../theme";
import { PlotFigure } from "./PlotFigure";

export function Timeline({ rows, theme }: { rows: TimelineRow[]; theme: Theme }) {
  const options = useMemo<Plot.PlotOptions>(
    () => ({
      height: 280,
      marginLeft: 40,
      x: { label: "Collection year", type: "band" },
      // An isolate with two carbapenemase families is stacked once per family.
      y: { label: "Isolates per carbapenemase family", grid: true },
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
