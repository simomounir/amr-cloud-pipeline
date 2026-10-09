import * as duckdb from "@duckdb/duckdb-wasm";
import type { Connection, Row } from "./connection";
import { DashboardError, loadManifest, type Manifest } from "./manifest";
import { type AnalysisCounts, analysisCounts } from "./queries";
import { createViews } from "./views";

const TABLES = ["samples", "amr_genes", "run_summary"] as const;

function wasmConnection(raw: duckdb.AsyncDuckDBConnection): Connection {
  return {
    async query<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
      let table;
      if (params.length) {
        const statement = await raw.prepare(sql);
        try {
          table = await statement.query(...params);
        } finally {
          await statement.close();
        }
      } else {
        table = await raw.query(sql);
      }
      return table.toArray().map((row) => row.toJSON() as T);
    },
  };
}

export async function openDashboardDb(
  baseUrl: string,
): Promise<{ conn: Connection; manifest: Manifest; tag: string; counts: AnalysisCounts }> {
  if (typeof WebAssembly === "undefined") throw new DashboardError("This dashboard needs a current browser (WebAssembly).");
  const manifest = await loadManifest(baseUrl);
  const tag = await fetch(new URL("TAG", baseUrl))
    .then((r) => (r.ok ? r.text() : ""))
    .then((t) => t.trim());
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" }),
  );
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), new Worker(workerUrl));
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);
  const conn = wasmConnection(await db.connect());
  for (const table of TABLES) {
    const url = new URL(`${table}.parquet`, baseUrl).href;
    await db.registerFileURL(`${table}.parquet`, url, duckdb.DuckDBDataProtocol.HTTP, false);
    await conn.query(`CREATE VIEW ${table} AS SELECT * FROM read_parquet('${table}.parquet')`);
  }
  await createViews(conn);
  return { conn, manifest, tag, counts: await analysisCounts(conn) };
}
