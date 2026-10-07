import { describe, expect, it } from "vitest";
import { createViews } from "../src/data/views";
import { fixtureConnection } from "./nodeConnection";

describe("views", () => {
  it("classifies acquired carbapenemases by family and ignores point mutations", async () => {
    const conn = await fixtureConnection();
    await createViews(conn);
    const rows = await conn.query("SELECT sample, gene_symbol, family FROM carbapenemases ORDER BY sample, gene_symbol");
    expect(rows).toEqual([
      { sample: "F1", gene_symbol: "blaKPC-2", family: "KPC" },
      { sample: "F2", gene_symbol: "blaNDM-5", family: "NDM" },
      { sample: "F3", gene_symbol: "blaNDM-1", family: "NDM" },
      { sample: "F3", gene_symbol: "blaOXA-232", family: "OXA-48-like" },
      { sample: "F5", gene_symbol: "blaKPC-3", family: "KPC" },
    ]);
  });

  it("builds one isolate row per sample with joined gene lists", async () => {
    const conn = await fixtureConnection();
    await createViews(conn);
    const rows = await conn.query(
      "SELECT sample, carbapenemase_genes, ctxm_genes, has_carbapenemase, has_ctxm FROM isolates ORDER BY sample",
    );
    expect(rows[2]).toEqual({
      sample: "F3",
      carbapenemase_genes: "blaNDM-1, blaOXA-232",
      ctxm_genes: null,
      has_carbapenemase: true,
      has_ctxm: false,
    });
    expect(rows[3]).toEqual({
      sample: "F4",
      carbapenemase_genes: null,
      ctxm_genes: "blaCTX-M-14",
      has_carbapenemase: false,
      has_ctxm: true,
    });
    expect(rows).toHaveLength(6);
  });
});
