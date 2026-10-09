import { describe, expect, it } from "vitest";
import { createViews } from "../src/data/views";
import { fixtureConnection } from "./nodeConnection";

describe("views", () => {
  it("classifies acquired carbapenemases by family and ignores point mutations", async () => {
    const conn = await fixtureConnection();
    await createViews(conn);
    const rows = await conn.query("SELECT sample, gene_symbol, family FROM carbapenemases WHERE study = 'study-a' ORDER BY sample, gene_symbol");
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
      "SELECT sample, carbapenemase_genes, ctxm_genes, has_carbapenemase, has_ctxm FROM isolates WHERE study = 'study-a' ORDER BY sample",
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

  it("keeps studies apart: a genome in two studies is one row per study", async () => {
    const conn = await fixtureConnection();
    await createViews(conn);
    const rows = await conn.query<{ study: string; n: number }>(
      "SELECT study, count(*)::INTEGER AS n FROM isolates WHERE sample = 'F1' GROUP BY study ORDER BY study",
    );
    expect(rows).toEqual([{ study: "study-a", n: 1 }, { study: "study-b", n: 1 }]);
  });

  it("adds clone, period, family list and combo, and the cohort's year where ENA has none", async () => {
    const conn = await fixtureConnection();
    await createViews(conn);
    const [f3] = await conn.query("SELECT clone, period, family_list, family_combo FROM isolates WHERE study='study-a' AND sample='F3'");
    expect(f3).toEqual({ clone: "ST147", period: "2018 or later", family_list: ["NDM", "OXA-48-like"], family_combo: "NDM+OXA-48-like" });
    const [f4] = await conn.query("SELECT collection_year, family_list, family_combo FROM isolates WHERE study='study-a' AND sample='F4'");
    expect(f4).toEqual({ collection_year: 2016, family_list: ["none"], family_combo: "none" });
    const [g1] = await conn.query("SELECT clone, period FROM isolates WHERE study='study-b' AND sample='G1'");
    expect(g1).toEqual({ clone: null, period: null }); // study without cohort.csv still works
  });
});
