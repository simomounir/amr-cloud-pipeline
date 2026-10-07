import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import type { HeatmapRow } from "../data/queries";
import { PlotFigure } from "./PlotFigure";

export function Heatmap({ rows }: { rows: HeatmapRow[] }) {
  const options = useMemo<Plot.PlotOptions>(
    () => ({
      height: 40 + rows.length * 22,
      marginLeft: 130,
      x: { label: null, axis: "top" },
      y: { label: null, domain: rows.map((r) => r.gene_symbol) },
      color: { scheme: "blues", domain: [0, 1], legend: true, label: "Share of shown isolates", tickFormat: "%" },
      marks: [
        Plot.cell(rows, { x: "drug_class", y: "gene_symbol", fill: "share", tip: true }),
        Plot.text(rows, {
          x: "drug_class",
          y: "gene_symbol",
          text: (d: HeatmapRow) => `${Math.round(d.share * 100)}%`,
          fill: (d: HeatmapRow) => (d.share > 0.5 ? "white" : "black"),
        }),
      ],
    }),
    [rows],
  );
  return (
    <PlotFigure
      options={options}
      summary={`Top ${rows.length} AMR elements; most common ${rows[0]?.gene_symbol ?? "none"}`}
    />
  );
}
