import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS } from "../src/data/filters";
import { parseHash, toHash } from "../src/state/url";

describe("url state", () => {
  it("parses routes", () => {
    expect(parseHash("").route).toEqual({ page: "home" });
    expect(parseHash("#/").route).toEqual({ page: "home" });
    expect(parseHash("#/study/carbapenemase-clones").route).toEqual({ page: "study", study: "carbapenemase-clones" });
    expect(parseHash("#/explore").route).toEqual({ page: "explore" });
    expect(parseHash("#/method").route).toEqual({ page: "method" });
  });
  it("round-trips a selection", () => {
    const filters = { ...EMPTY_FILTERS, clones: ["ST147"], families: ["NDM", "OXA-48-like"], yearMin: 2013, hideQcWarnings: false };
    const hash = toHash({ page: "study", study: "s1" }, filters);
    expect(hash).toBe("#/study/s1?clone=ST147&family=NDM,OXA-48-like&from=2013&qc=all");
    expect({ ...EMPTY_FILTERS, ...parseHash(hash).filters }).toEqual(filters);
  });
  it("encodes values with commas and spaces", () => {
    const hash = toHash({ page: "explore" }, { countries: ["Korea, Republic of", "Côte d'Ivoire"] });
    expect(parseHash(hash).filters.countries).toEqual(["Korea, Republic of", "Côte d'Ivoire"]);
  });
  it("ignores unknown keys, bad numbers and unknown pages", () => {
    expect(parseHash("#/nope?x=1").route).toEqual({ page: "home" });
    expect(parseHash("#/explore?from=abc&bogus=1&clone=").filters).toEqual({});
    expect(parseHash("#/study/").route).toEqual({ page: "home" });
  });
});
