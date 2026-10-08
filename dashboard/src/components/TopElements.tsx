import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import type { ElementRow } from "../data/queries";
import { PlotFigure } from "./PlotFigure";

const pct = (share: number) => `${Math.round(share * 100)}%`;

export function TopElements({ rows }: { rows: ElementRow[] }) {
  const options = useMemo<Plot.PlotOptions>(
    () => ({
      height: 50 + rows.length * 22,
      marginLeft: 130,
      marginRight: 40,
      x: { domain: [0, 1], tickFormat: "%", label: "Share of shown isolates", grid: true },
      y: { label: null, domain: rows.map((r) => r.gene_symbol) },
      color: { legend: true, scheme: "tableau10" },
      marks: [
        Plot.barX(rows, { y: "gene_symbol", x: "share", fill: "drug_class", tip: true }),
        Plot.text(rows, { y: "gene_symbol", x: "share", text: (d: ElementRow) => pct(d.share), dx: 4, textAnchor: "start" }),
        Plot.ruleX([0]),
      ],
    }),
    [rows],
  );
  return (
    <PlotFigure
      options={options}
      summary={`Top ${rows.length} AMR elements; most common ${rows[0]?.gene_symbol ?? "none"} in ${pct(rows[0]?.share ?? 0)} of shown isolates`}
    />
  );
}
