import type { Connection } from "./connection";
import { runScript } from "./connection";
import viewsSql from "./sql/views.sql?raw";

export function createViews(conn: Connection): Promise<void> {
  return runScript(conn, viewsSql);
}
