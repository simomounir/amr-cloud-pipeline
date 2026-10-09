import { describe, expect, it } from "vitest";
import { isoNumeric } from "../src/data/countries";

describe("country codes", () => {
  it("maps amrtools country names to ISO numeric ids", () => {
    expect(isoNumeric("Germany")).toBe("276");
    expect(isoNumeric("United States")).toBe("840");
    expect(isoNumeric("Côte d'Ivoire")).toBe("384");
    expect(isoNumeric("Atlantis")).toBeNull();
  });
});
