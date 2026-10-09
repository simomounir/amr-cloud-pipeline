import * as duckdb from "@duckdb/duckdb-wasm";
import type { Connection, Row } from "./connection";
import { DashboardError, loadManifest, type Manifest } from "./manifest";
import { type AnalysisCounts, analysisCounts } from "./queries";
import { loadStudies, loadStudyInfo, type StudyEntry, type StudyInfo } from "./studies";
import { BASE_TABLES, baseViewsSql } from "./tables";
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
  manifests: Record<string, Manifest>;
  failed: { study: string; error: string }[];
  counts: Record<string, AnalysisCounts>;
}

async function exists(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { method: "HEAD" })).ok;
  } catch {
    return false;
  }
}

export async function openDashboardDb(dataUrl: string): Promise<DashboardDb> {
  if (typeof WebAssembly === "undefined") throw new DashboardError("This dashboard needs a current browser (WebAssembly).");
  const listed = await loadStudies(dataUrl);
  const manifests: Record<string, Manifest> = {};
  const failed: { study: string; error: string }[] = [];
  for (const { study } of listed) {
    try {
      manifests[study] = await loadManifest(new URL(`${study}/`, dataUrl).href);
    } catch (e) {
      failed.push({ study, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const studies = listed.filter((s) => s.study in manifests);
  if (studies.length === 0) throw new DashboardError(failed[0]?.error ?? "No studies are published yet.");
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" }),
  );
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), new Worker(workerUrl));
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);
  const conn = wasmConnection(await db.connect());
  const withCohort = new Set<string>();
  for (const { study } of studies) {
    for (const table of BASE_TABLES) {
      const url = new URL(`${study}/${table}.parquet`, dataUrl).href;
      if (table === "cohort") {
        if (!(await exists(url))) continue;
        withCohort.add(study);
      }
      await db.registerFileURL(`${study}__${table}.parquet`, url, duckdb.DuckDBDataProtocol.HTTP, false);
    }
  }
  const names = studies.map((s) => s.study);
  for (const sql of baseViewsSql(names, (s, t) => `${s}__${t}.parquet`, (s) => withCohort.has(s))) await conn.query(sql);
  await createViews(conn);
  const infos: Record<string, StudyInfo | null> = {};
  const counts: Record<string, AnalysisCounts> = {};
  for (const study of names) {
    infos[study] = await loadStudyInfo(dataUrl, study);
    counts[study] = await analysisCounts(conn, study);
  }
  return { conn, studies, infos, manifests, failed, counts };
}
