import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import type { ElementRow } from "../data/queries";
import { drugClassScale, type Theme } from "../theme";
import { PlotFigure } from "./PlotFigure";

const pct = (share: number) => `${Math.round(share * 100)}%`;

export function TopElements({ rows, theme }: { rows: ElementRow[]; theme: Theme }) {
  const options = useMemo<Plot.PlotOptions>(() => {
    // Rows arrive most common first, so the commonest drug classes get the first palette slots.
    const scale = drugClassScale(rows.map((r) => r.drug_class), theme);
    return {
      height: 50 + rows.length * 22,
      marginLeft: 130,
      marginRight: 40,
      x: { domain: [0, 1], tickFormat: "%", label: "Share of shown genomes", grid: true },
      y: { label: null, domain: rows.map((r) => r.gene_symbol) },
      color: { legend: true, domain: scale.domain, range: scale.range },
      marks: [
        Plot.barX(rows, {
          y: "gene_symbol",
          x: "share",
          fill: (d: ElementRow) => scale.fold(d.drug_class),
          title: (d: ElementRow) => `${d.gene_symbol}\n${d.drug_class}: ${d.carriers} carriers (${pct(d.share)})`,
          tip: true,
        }),
        Plot.text(rows, { y: "gene_symbol", x: "share", text: (d: ElementRow) => pct(d.share), dx: 4, textAnchor: "start" }),
        Plot.ruleX([0]),
      ],
    };
  }, [rows, theme]);
  return (
    <PlotFigure
      options={options}
      summary={`Top ${rows.length} AMR elements; most common ${rows[0]?.gene_symbol ?? "none"} in ${pct(rows[0]?.share ?? 0)} of shown genomes`}
    />
  );
}
