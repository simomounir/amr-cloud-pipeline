import { DuckDBInstance, type DuckDBValue } from "@duckdb/node-api";
import { fileURLToPath } from "node:url";
import type { Connection, Row } from "../src/data/connection";

const FIXTURE = fileURLToPath(new URL("./fixtures/data/", import.meta.url));
export const TABLES = ["samples", "amr_genes", "run_summary"] as const;

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
  for (const table of TABLES) {
    await conn.query(`CREATE VIEW ${table} AS SELECT * FROM read_parquet('${directory}${table}.parquet')`);
  }
  return conn;
}
