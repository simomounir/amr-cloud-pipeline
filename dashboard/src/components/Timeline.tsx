import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import type { TimelineRow } from "../data/queries";
import { PlotFigure } from "./PlotFigure";

// Okabe-Ito colour-blind-safe palette.
const FAMILIES = ["KPC", "NDM", "OXA-48-like", "VIM", "IMP", "other", "none"];
const COLOURS = ["#D55E00", "#0072B2", "#E69F00", "#009E73", "#CC79A7", "#56B4E9", "#BBBBBB"];

export function Timeline({ rows }: { rows: TimelineRow[] }) {
  const options = useMemo<Plot.PlotOptions>(
    () => ({
      height: 280,
      marginLeft: 40,
      x: { label: "Collection year", type: "band" },
      y: { label: "Isolates", grid: true },
      color: { domain: FAMILIES, range: COLOURS, legend: true },
      marks: [Plot.barY(rows, { x: "year", y: "isolates", fill: "family", tip: true }), Plot.ruleY([0])],
    }),
    [rows],
  );
  const detections = rows.filter((r) => r.family !== "none").reduce((n, r) => n + r.isolates, 0);
  const groups = new Set(rows.map((r) => r.year)).size;
  return <PlotFigure options={options} summary={`${detections} carbapenemase detections across ${groups} year groups`} />;
}
