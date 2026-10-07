import { expect, it } from "vitest";
import { toCsv } from "../src/data/csv";

it("quotes commas, quotes and newlines; nulls are empty", () => {
  const csv = toCsv(
    [
      { a: "plain", b: 'say "hi"', c: null },
      { a: "x, y", b: "line\nbreak", c: 3 },
    ],
    ["a", "b", "c"],
  );
  expect(csv).toBe('a,b,c\nplain,"say ""hi""",\n"x, y","line\nbreak",3\n');
});
