import * as duckdb from "@duckdb/duckdb-wasm";
import type { Connection, Row } from "./connection";
import { DashboardError, type Manifest } from "./manifest";
import { type AnalysisCounts, analysisCounts } from "./queries";
import { loadAvailableStudies } from "./loadStudies";
import { loadStudies, type StudyEntry, type StudyInfo } from "./studies";
import { baseViewsSql } from "./tables";
import { createViews } from "./views";

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

export interface DashboardDb {
  conn: Connection;
  studies: StudyEntry[];
  infos: Record<string, StudyInfo | null>;
  hasCohort: Record<string, boolean>;
  manifests: Record<string, Manifest>;
  failed: { study: string; error: string }[];
  counts: Record<string, AnalysisCounts>;
}

export async function openDashboardDb(dataUrl: string): Promise<DashboardDb> {
  if (typeof WebAssembly === "undefined") throw new DashboardError("This dashboard needs a current browser (WebAssembly).");
  const listed = await loadStudies(dataUrl);
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" }),
  );
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), new Worker(workerUrl));
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);
  const conn = wasmConnection(await db.connect());
  const fileFor = (study: string, table: string) => `${study}__${table}.parquet`;
  // One broken study (bad manifest, study.json or table) is reported in `failed`; the rest load.
  const { loaded, failed } = await loadAvailableStudies(dataUrl, listed, {
    register: (study, table, url) =>
      db.registerFileURL(fileFor(study, table), url, duckdb.DuckDBDataProtocol.HTTP, false),
    probe: async (study, table) => {
      await conn.query(`SELECT 1 FROM read_parquet('${fileFor(study, table)}') LIMIT 0`);
    },
  });
  if (loaded.length === 0) throw new DashboardError(failed[0]?.error ?? "No studies are published yet.");
  const studies = loaded.map(({ study }) => listed.find((s) => s.study === study) as StudyEntry);
  const withCohort = new Set(loaded.filter((l) => l.hasCohort).map((l) => l.study));
  for (const sql of baseViewsSql(
    studies.map((s) => s.study),
    fileFor,
    (s) => withCohort.has(s),
  ))
    await conn.query(sql);
  await createViews(conn);
  const manifests: Record<string, Manifest> = {};
  const infos: Record<string, StudyInfo | null> = {};
  const counts: Record<string, AnalysisCounts> = {};
  for (const { study, manifest, info } of loaded) {
    manifests[study] = manifest;
    infos[study] = info;
    counts[study] = await analysisCounts(conn, study);
  }
  const hasCohort = Object.fromEntries(loaded.map((l) => [l.study, l.hasCohort]));
  return { conn, studies, infos, hasCohort, manifests, failed, counts };
}
