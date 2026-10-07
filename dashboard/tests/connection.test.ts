import { describe, expect, it } from "vitest";
import { runScript } from "../src/data/connection";
import { fixtureConnection } from "./nodeConnection";

describe("connection", () => {
  it("reads the fixture tables with plain JS numbers", async () => {
    const conn = await fixtureConnection();
    const rows = await conn.query<{ n: number }>("SELECT count(*)::INTEGER AS n FROM samples");
    expect(rows).toEqual([{ n: 6 }]);
  });

  it("binds parameters", async () => {
    const conn = await fixtureConnection();
    const rows = await conn.query("SELECT sample FROM samples WHERE country = ? ORDER BY sample", ["Côte d'Ivoire"]);
    expect(rows).toEqual([{ sample: "F6" }]);
  });

  it("runs multi-statement scripts", async () => {
    const conn = await fixtureConnection();
    await runScript(conn, "CREATE VIEW a AS SELECT 1 AS x;\nCREATE VIEW b AS SELECT x + 1 AS y FROM a;\n");
    expect(await conn.query("SELECT y::INTEGER AS y FROM b")).toEqual([{ y: 2 }]);
  });
});
