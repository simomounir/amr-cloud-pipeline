import { DuckDBInstance, type DuckDBValue } from "@duckdb/node-api";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Connection, Row } from "../src/data/connection";
import { baseViewsSql } from "../src/data/tables";

const FIXTURE = fileURLToPath(new URL("./fixtures/data/", import.meta.url));

export async function emptyConnection(): Promise<Connection> {
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  return {
    async query<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
      const reader = await conn.runAndReadAll(sql, params as DuckDBValue[]);
      return reader.getRowObjectsJS() as T[];
    },
  };
}

export async function fixtureConnection(directory = FIXTURE): Promise<Connection> {
  const conn = await emptyConnection();
  const studies = (JSON.parse(readFileSync(`${directory}studies.json`, "utf8")) as { study: string }[]).map((s) => s.study);
  const statements = baseViewsSql(
    studies,
    (s, t) => `${directory}${s}/${t}.parquet`,
    (s) => existsSync(`${directory}${s}/cohort.parquet`),
  );
  for (const sql of statements) await conn.query(sql);
  return conn;
}
