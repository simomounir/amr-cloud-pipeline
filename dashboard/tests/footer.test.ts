import { describe, expect, it } from "vitest";
import { footerEntries } from "../src/data/footer";
import type { Manifest } from "../src/data/manifest";

const manifest = { created_at: "2026-10-01T00:00:00Z", schema_version: "1.2.0" } as unknown as Manifest;

describe("footerEntries", () => {
  it("labels a failed or half-loaded study instead of throwing", () => {
    const rows = footerEntries(
      [{ study: "a", release: "r-a" }, { study: "b", release: "r-b" }],
      { a: manifest },
      { a: { analysed: 6, failed: 1 } },
      [{ study: "c", error: "bad schema" }],
    );
    expect(rows.map((r) => [r.study, r.ok])).toEqual([["a", true], ["b", false], ["c", false]]);
    expect(rows[2]).toEqual({ ok: false, study: "c", error: "bad schema" });
  });
});
