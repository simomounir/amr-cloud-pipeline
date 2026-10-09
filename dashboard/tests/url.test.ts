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
    expect(hash).toBe("#/study/s1?clone=ST147&family=NDM,OXA-48-like&from=2013");
    expect({ ...EMPTY_FILTERS, ...parseHash(hash).filters }).toEqual(filters);
  });
  it("QC warnings default to shown on a study route and hidden on explore", () => {
    const study = { page: "study", study: "s1" } as const;
    expect(parseHash("#/study/s1").filters.hideQcWarnings).toBe(false);
    expect(parseHash("#/study/s1?qc=pass").filters.hideQcWarnings).toBe(true);
    expect(parseHash("#/study/s1?qc=all").filters.hideQcWarnings).toBe(false);
    expect({ ...EMPTY_FILTERS, ...parseHash("#/explore").filters }.hideQcWarnings).toBe(true);
    expect(parseHash("#/explore?qc=all").filters.hideQcWarnings).toBe(false);
    expect(parseHash("#/explore?qc=pass").filters.hideQcWarnings).toBe(true);
    expect(toHash(study, { ...EMPTY_FILTERS, hideQcWarnings: true })).toBe("#/study/s1?qc=pass");
    expect(toHash(study, { ...EMPTY_FILTERS, hideQcWarnings: false })).toBe("#/study/s1");
    expect(toHash(study)).toBe("#/study/s1");
    expect(toHash({ page: "explore" }, { hideQcWarnings: false })).toBe("#/explore?qc=all");
    expect(toHash({ page: "explore" }, { hideQcWarnings: true })).toBe("#/explore");
    expect(toHash({ page: "explore" })).toBe("#/explore");
  });
  it("round-trips the QC choice on both routes", () => {
    for (const route of [{ page: "study", study: "s1" }, { page: "explore" }] as const) {
      for (const hideQcWarnings of [true, false]) {
        const filters = { ...EMPTY_FILTERS, clones: ["ST1"], hideQcWarnings };
        expect({ ...EMPTY_FILTERS, ...parseHash(toHash(route, filters)).filters }).toEqual(filters);
      }
    }
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
  it("drops malformed percent-encoding instead of throwing", () => {
    expect(() => parseHash("#/explore?country=%E0%A4%A&clone=%")).not.toThrow();
    expect(parseHash("#/explore?country=%E0%A4%A&clone=%").filters).toEqual({});
    expect(parseHash("#/explore?country=Germany,%E0%A4%A").filters.countries).toEqual(["Germany"]);
  });
  it("ignores inherited object keys", () => {
    expect(parseHash("#/explore?constructor=x&__proto__=y&toString=z").filters).toEqual({});
  });
});
