import { useMemo, useState } from "react";
import { toCsv } from "../data/csv";
import type { IsolateRow } from "../data/queries";

const COLUMNS: (keyof IsolateRow)[] = [
  "sample",
  "run_accession",
  "country",
  "collection_year",
  "source_category",
  "st",
  "carbapenemase_genes",
  "ctxm_genes",
  "qc_status",
];
const HEADERS: Record<keyof IsolateRow, string> = {
  sample: "Sample",
  run_accession: "Run",
  country: "Country",
  collection_year: "Year",
  source_category: "Source",
  st: "ST",
  carbapenemase_genes: "Carbapenemases",
  ctxm_genes: "CTX-M",
  qc_status: "QC",
};
const PAGE = 50;

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  link.click();
  URL.revokeObjectURL(url);
}

export function IsolateTable({ rows }: { rows: IsolateRow[] }) {
  const [sort, setSort] = useState<{ key: keyof IsolateRow; asc: boolean }>({ key: "sample", asc: true });
  const [page, setPage] = useState(0);
  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const x = a[sort.key] ?? "";
        const y = b[sort.key] ?? "";
        return (x < y ? -1 : x > y ? 1 : 0) * (sort.asc ? 1 : -1);
      }),
    [rows, sort],
  );
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));
  const current = Math.min(page, pages - 1);
  const shown = sorted.slice(current * PAGE, current * PAGE + PAGE);
  return (
    <>
      <div className="table-actions">
        <button onClick={() => download(toCsv(sorted as unknown as Record<string, unknown>[], COLUMNS), "isolates.csv")}>
          Download CSV
        </button>
        <span>{rows.length} isolates</span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c} aria-sort={sort.key === c ? (sort.asc ? "ascending" : "descending") : "none"}>
                  <button onClick={() => setSort({ key: c, asc: sort.key === c ? !sort.asc : true })}>
                    {HEADERS[c]}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.sample}>
                <td>
                  {r.run_accession ? (
                    <a href={`https://www.ebi.ac.uk/ena/browser/view/${r.run_accession}`} target="_blank" rel="noreferrer">
                      {r.sample}
                    </a>
                  ) : (
                    r.sample
                  )}
                </td>
                {COLUMNS.slice(1).map((c) => (
                  <td key={c}>{c === "source_category" ? r[c].replace(/_/g, " ") : (r[c] ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <nav className="pager" aria-label="Table pages">
          <button disabled={current === 0} onClick={() => setPage(current - 1)}>
            Previous
          </button>
          <span>
            Page {current + 1} of {pages}
          </span>
          <button disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
            Next
          </button>
        </nav>
      )}
    </>
  );
}
