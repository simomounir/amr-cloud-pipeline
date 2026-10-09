import { describe, expect, it } from "vitest";
import { inline } from "../src/text";

describe("inline markup", () => {
  it("handles emphasis, strong and links", () => {
    expect(inline("A *K. pneumoniae* **KPC** [ENA](https://www.ebi.ac.uk/ena) end")).toEqual([
      { kind: "text", text: "A " }, { kind: "em", text: "K. pneumoniae" }, { kind: "text", text: " " },
      { kind: "strong", text: "KPC" }, { kind: "text", text: " " },
      { kind: "link", text: "ENA", href: "https://www.ebi.ac.uk/ena" }, { kind: "text", text: " end" },
    ]);
  });
  it("only allows http(s) links", () => {
    expect(inline("[x](javascript:alert(1))")).toEqual([{ kind: "text", text: "[x](javascript:alert(1))" }]);
  });
});
