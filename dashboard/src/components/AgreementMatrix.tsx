import * as Plot from "@observablehq/plot";
import { useMemo } from "react";
import type { Agreement } from "../data/studies";
import { FAMILY_ORDER, SEQUENTIAL, sortCombos, type Theme } from "../theme";
import { PlotFigure } from "./PlotFigure";

const pct = (a: { agree: number; total: number }) => `${a.agree}/${a.total} (${a.total ? Math.round((a.agree / a.total) * 100) : 0}%)`;

type Cell = Agreement["family_matrix"][number];

export function AgreementMatrix({ agreement, referenceName, theme }: { agreement: Agreement | null; referenceName: string; theme: Theme }) {
  const options = useMemo<Plot.PlotOptions | null>(() => {
    if (!agreement) return null;
    const extra = sortCombos(agreement.family_matrix.flatMap((c) => [c.ours, c.reference]).filter((f) => !FAMILY_ORDER.includes(f)));
    const domain = [...FAMILY_ORDER, ...extra];
    const max = Math.max(1, ...agreement.family_matrix.map((c) => c.genomes));
    // The fill follows a sqrt scale, so the text colour switches on the scaled value, not the raw count.
    return {
      marginLeft: 100,
      marginBottom: 60,
      height: 80 + domain.length * 36,
      x: { domain, label: `${referenceName} call`, tickRotate: -30 },
      y: { domain, label: "Our call" },
      color: { type: "sqrt", domain: [0, max], range: SEQUENTIAL[theme] },
      marks: [
        Plot.cell(agreement.family_matrix, {
          x: "reference",
          y: "ours",
          fill: "genomes",
          stroke: (d: Cell) => (d.ours === d.reference ? "var(--ink)" : "var(--line)"),
          strokeWidth: (d: Cell) => (d.ours === d.reference ? 2 : 0.5),
          ariaLabel: (d: Cell) => `ours ${d.ours}, ${referenceName} ${d.reference}: ${d.genomes}`,
          title: (d: Cell) => `ours ${d.ours}, ${referenceName} ${d.reference}: ${d.genomes} genomes`,
          tip: true,
        }),
        Plot.text(agreement.family_matrix, {
          x: "reference",
          y: "ours",
          text: "genomes",
          fill: (d: Cell) => (Math.sqrt(d.genomes / max) > 0.5 ? (theme === "light" ? "#ffffff" : "#0f1419") : "var(--ink)"),
          pointerEvents: "none",
        }),
      ],
    } as Plot.PlotOptions;
  }, [agreement, referenceName, theme]);
  if (!agreement || !options) return <p className="panel-empty">No reference calls for this study.</p>;
  return (
    <>
      <dl className="headline">
        <div>
          <dt>ST</dt>
          <dd>{pct(agreement.st)}</dd>
        </div>
        <div>
          <dt>Carbapenemase family</dt>
          <dd>{pct(agreement.carbapenemase_family)}</dd>
        </div>
      </dl>
      <PlotFigure options={options} summary={`Carbapenemase family calls against ${referenceName}: ${pct(agreement.carbapenemase_family)} agree`} />
      {agreement.disagreements.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Sample</th>
                <th>Field</th>
                <th>Ours</th>
                <th>{referenceName}</th>
              </tr>
            </thead>
            <tbody>
              {agreement.disagreements.map((d) => (
                <tr key={`${d.sample}-${d.field}`}>
                  <td>
                    <a href={`https://www.ebi.ac.uk/ena/browser/view/${d.sample}`} target="_blank" rel="noreferrer">
                      {d.sample}
                    </a>
                  </td>
                  <td>{d.field === "st" ? "ST" : "Carbapenemase family"}</td>
                  <td>{d.ours ?? "–"}</td>
                  <td>{d.reference ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
