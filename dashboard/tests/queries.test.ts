import { beforeAll, describe, expect, it } from "vitest";
import type { Connection } from "../src/data/connection";
import { EMPTY_FILTERS } from "../src/data/filters";
import { analysisCounts, cohortGenomeCount, countryCounts, familyHeatmap, periodMix, headline, topElements, isolateRows, options, timeline, yearBounds } from "../src/data/queries";
import { createViews } from "../src/data/views";
import { fixtureConnection } from "./nodeConnection";

let conn: Connection;
beforeAll(async () => {
  conn = await fixtureConnection();
  await createViews(conn);
});

const A = { ...EMPTY_FILTERS, studies: ["study-a"] };
const ALL = { ...A, hideQcWarnings: false };

describe("headline", () => {
  it("summarises QC-passing isolates by default", async () => {
    expect(await headline(conn, A)).toEqual({
      isolates: 5,
      carbapenemase_share: 0.6,
      ctxm_share: 0.6,
      countries: 4,
      year_min: 2016,
      year_max: 2021,
      year_known_share: 1,
    });
  });

  it("returns zeros, not NaN, when nothing matches", async () => {
    const result = await headline(conn, { ...A, countries: ["Atlantis"] });
    expect(result).toEqual({
      isolates: 0,
      carbapenemase_share: 0,
      ctxm_share: 0,
      countries: 0,
      year_min: null,
      year_max: null,
      year_known_share: 0,
    });
  });

  it("filters by a country containing an apostrophe", async () => {
    expect((await headline(conn, { ...A, countries: ["Côte d'Ivoire"] })).isolates).toBe(1);
  });
});

describe("timeline", () => {
  it("counts isolates per year and family with undated kept separate", async () => {
    expect(await timeline(conn, A)).toEqual([
      { year: "2016", family: "none", isolates: 1 },
      { year: "2018", family: "none", isolates: 1 },
      { year: "2019", family: "KPC", isolates: 1 },
      { year: "2021", family: "NDM", isolates: 2 },
      { year: "2021", family: "OXA-48-like", isolates: 1 },
    ]);
  });

  it("drops isolates outside a year range", async () => {
    const rows = await timeline(conn, { ...A, yearMin: 2019 });
    expect(rows.map((r) => r.year)).toEqual(["2019", "2021", "2021"]);
  });
});

describe("top acquired elements", () => {
  it("ranks AMR elements by carriers with share of shown isolates", async () => {
    const rows = await topElements(conn, A);
    expect(rows[0]).toEqual({ gene_symbol: "blaCTX-M-15", drug_class: "BETA-LACTAM", carriers: 2, share: 0.4 });
    expect(rows.map((r) => r.gene_symbol)).toContain("ompK36_D135DGD");
    expect(rows.map((r) => r.gene_symbol)).not.toContain("iutA");
    expect(rows.map((r) => r.gene_symbol)).not.toContain("blaKPC-3"); // F5 hidden by QC
  });

  it("is empty, not an error, when nothing matches", async () => {
    expect(await topElements(conn, { ...A, countries: ["Atlantis"] })).toEqual([]);
  });

  it("leaves out intrinsic chromosomal genes unless asked", async () => {
    const acquired = (await topElements(conn, A)).map((r) => r.gene_symbol);
    expect(acquired).not.toContain("fosA");
    expect(acquired).not.toContain("blaSHV-11");
    const all = await topElements(conn, A, true);
    expect(all[0]).toEqual({ gene_symbol: "fosA", drug_class: "FOSFOMYCIN", carriers: 4, share: 0.8 });
    expect(all.map((r) => r.gene_symbol)).toContain("blaSHV-11");
  });
});

describe("isolate table", () => {
  it("lists carbapenemase carriers including QC warnings when shown", async () => {
    const rows = await isolateRows(conn, { ...ALL, carbapenemaseOnly: true });
    expect(rows.map((r) => r.sample)).toEqual(["F1", "F2", "F3", "F5"]);
    expect(rows[2]).toMatchObject({
      country: "India",
      collection_year: 2021,
      carbapenemase_genes: "blaNDM-1, blaOXA-232",
      st: "ST147",
    });
  });
});

describe("studies", () => {
  it("counts a genome shared by two studies once per study", async () => {
    expect((await headline(conn, EMPTY_FILTERS)).isolates).toBe(7); // 5 QC-passing in study-a, plus F1 and G1 in study-b
  });
});

describe("family filter", () => {
  it("keeps isolates carrying any selected family", async () => {
    const rows = await isolateRows(conn, { ...A, families: ["NDM"] });
    expect(rows.map((r) => r.sample)).toEqual(["F2", "F3"]);
  });
});

describe("filter options", () => {
  it("counts each option under the other filters", async () => {
    expect(await options(conn, A, "countries")).toEqual([
      { value: "Germany", isolates: 2 },
      { value: "Côte d'Ivoire", isolates: 1 },
      { value: "India", isolates: 1 },
      { value: "United States", isolates: 1 },
    ]);
  });

  it("ignores its own selection so other options stay visible", async () => {
    const rows = await options(conn, { ...ALL, countries: ["India"] }, "countries");
    expect(rows.find((r) => r.value === "India")).toEqual({ value: "India", isolates: 2 });
    expect(rows).toHaveLength(4);
  });

  it("year bounds cover all isolates", async () => {
    expect(await yearBounds(conn)).toEqual({ min: 2016, max: 2022 });
  });
});

describe("analysisCounts", () => {
  it("counts analysed isolates and those whose analysis failed (no run_summary row)", async () => {
    expect(await analysisCounts(conn, "study-a")).toEqual({ analysed: 6, failed: 1 });
  });

  it("counts across all studies when none is given", async () => {
    expect(await analysisCounts(conn)).toEqual({ analysed: 8, failed: 1 });
  });
});

describe("study figures", () => {
  const S = { ...EMPTY_FILTERS, studies: ["study-a"], hideQcWarnings: false };
  it("heatmap: share of genomes per clone carrying each family", async () => {
    const cells = await familyHeatmap(conn, S, false);
    expect(cells.find((c) => c.clone === "ST147" && c.family === "NDM")).toEqual({ clone: "ST147", period: "all", family: "NDM", genomes: 2, carriers: 2, share: 1 });
    expect(cells.find((c) => c.clone === "ST147" && c.family === "OXA-48-like")?.share).toBe(0.5);
  });
  it("heatmap by period splits the denominator", async () => {
    const cells = await familyHeatmap(conn, S, true);
    expect(cells.filter((c) => c.clone === "ST11").map((c) => c.period).sort()).toEqual(["2013-2017", "2018 or later"]);
  });
  it("counts the genomes the cohort figures show, directly", async () => {
    for (const byPeriod of [false, true]) {
      const perCell = new Map((await familyHeatmap(conn, S, byPeriod)).map((c) => [`${c.clone}|${c.period}`, c.genomes]));
      expect(await cohortGenomeCount(conn, S, byPeriod)).toBe([...perCell.values()].reduce((a, b) => a + b, 0));
    }
    expect(await cohortGenomeCount(conn, S, false)).toBe(6);
  });
  it("period mix: exclusive combos that sum to 1 per clone and period", async () => {
    const rows = await periodMix(conn, S);
    const st147 = rows.filter((r) => r.clone === "ST147" && r.period === "2018 or later");
    expect(st147.map((r) => [r.combo, r.share])).toEqual([["NDM", 0.5], ["NDM+OXA-48-like", 0.5]]);
  });
  it("countries with their clones and families", async () => {
    const rows = await countryCounts(conn, S);
    expect(rows.find((r) => r.country === "India")).toEqual({ country: "India", genomes: 2, clones: "ST11, ST147", families: "KPC, NDM, OXA-48-like" });
  });
});
