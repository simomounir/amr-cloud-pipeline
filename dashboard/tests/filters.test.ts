import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, toWhere } from "../src/data/filters";

describe("toWhere", () => {
  it("hides QC warnings by default", () => {
    expect(toWhere(EMPTY_FILTERS)).toEqual({ sql: "WHERE qc_status = 'pass'", params: [] });
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
    const where = toWhere({ ...EMPTY_FILTERS, countries: ["India"], sts: ["ST147"] }, "countries");
    expect(where.sql).toBe("WHERE st IN (?) AND qc_status = 'pass'");
    expect(where.params).toEqual(["ST147"]);
  });
});
