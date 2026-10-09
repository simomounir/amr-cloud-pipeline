import type { ReactNode } from "react";

export interface FigureTable {
  columns: string[];
  rows: (string | number | null)[][];
}

/** A titled figure with its caption (n) and the same rows as a table, for readers who cannot rely on colour. */
export function FigureFrame({
  figure,
  title,
  caption,
  children,
  table,
}: {
  figure: string;
  title: string;
  caption: string;
  children: ReactNode;
  table: FigureTable;
}) {
  return (
    <section className="figure-frame" data-figure={figure}>
      <h3>{title}</h3>
      {children}
      <p className="note">{caption}</p>
      <details>
        <summary>Show as table</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {table.columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{cell ?? "–"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
