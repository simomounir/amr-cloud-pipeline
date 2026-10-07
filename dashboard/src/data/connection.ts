export type Row = Record<string, unknown>;

export interface Connection {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
}

/** Run several statements separated by ';' at line ends (views.sql style). */
export async function runScript(conn: Connection, script: string): Promise<void> {
  for (const statement of script.split(/;\s*(?:\n|$)/)) {
    if (statement.trim()) await conn.query(statement);
  }
}
