import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, toWhere } from "../src/data/filters";

describe("toWhere", () => {
  it("includes QC warnings by default (no qc clause)", () => {
    expect(toWhere(EMPTY_FILTERS)).toEqual({ sql: "", params: [] });
    expect(toWhere({ ...EMPTY_FILTERS, hideQcWarnings: true })).toEqual({ sql: "WHERE qc_status = 'pass'", params: [] });
  });

  it("is empty when nothing is filtered", () => {
    expect(toWhere({ ...EMPTY_FILTERS, hideQcWarnings: false })).toEqual({ sql: "", params: [] });
  });

  it("passes user values only as parameters", () => {
    const where = toWhere({
      ...EMPTY_FILTERS,
      hideQcWarnings: false,
      countries: ["Côte d'Ivoire", "x'); DROP TABLE samples;--"],
    });
    expect(where.sql).toBe("WHERE country IN (?, ?)");
    expect(where.params).toEqual(["Côte d'Ivoire", "x'); DROP TABLE samples;--"]);
  });

  it("combines all filters in a fixed order", () => {
    const where = toWhere({
      ...EMPTY_FILTERS,
      countries: ["India"],
      sources: ["wound"],
      sts: ["ST147"],
      yearMin: 2019,
      yearMax: 2021,
      carbapenemaseOnly: true,
      hideQcWarnings: true,
    });
    expect(where.sql).toBe(
      "WHERE country IN (?) AND source_category IN (?) AND st IN (?) AND collection_year >= ? AND collection_year <= ? AND has_carbapenemase AND qc_status = 'pass'",
    );
    expect(where.params).toEqual(["India", "wound", "ST147", 2019, 2021]);
  });

  it("can omit one list filter (for that filter's own option counts)", () => {
    const where = toWhere({ ...EMPTY_FILTERS, countries: ["India"], sts: ["ST147"], hideQcWarnings: true }, "countries");
    expect(where.sql).toBe("WHERE st IN (?) AND qc_status = 'pass'");
    expect(where.params).toEqual(["ST147"]);
  });

  it("filters by clone, period, combo and carried family", () => {
    const where = toWhere({ ...EMPTY_FILTERS, clones: ["ST147"], families: ["NDM", "VIM"], combos: ["none"], hideQcWarnings: false });
    expect(where.sql).toBe("WHERE clone IN (?) AND family_combo IN (?) AND len(list_intersect(family_list, [?, ?])) > 0");
    expect(where.params).toEqual(["ST147", "none", "NDM", "VIM"]);
  });
});
