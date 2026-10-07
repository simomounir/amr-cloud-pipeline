import { describe, expect, it } from "vitest";
import { DashboardError, checkSchema, loadManifest, type Manifest } from "../src/data/manifest";

const manifest = (schema_version: string): Manifest => ({
  schema_version,
  created_at: "2026-10-08T00:00:00Z",
  runs: [],
  tables: {},
});

describe("manifest", () => {
  it("accepts any 1.x schema", () => {
    expect(() => checkSchema(manifest("1.0.0"))).not.toThrow();
    expect(() => checkSchema(manifest("1.7.2"))).not.toThrow();
  });

  it("rejects another major version with a clear message", () => {
    expect(() => checkSchema(manifest("2.0.0"))).toThrow(
      new DashboardError("Dataset schema 2.0.0 is not supported by this dashboard (needs 1.x)"),
    );
  });

  it("reports an unreachable manifest with its URL", async () => {
    const failing = async () => new Response("nope", { status: 404 });
    await expect(loadManifest("https://example.org/data/", failing)).rejects.toThrow(
      "Dataset unavailable: https://example.org/data/manifest.json (HTTP 404)",
    );
  });

  it("loads and checks a good manifest", async () => {
    const ok = async () => new Response(JSON.stringify(manifest("1.1.0")));
    expect((await loadManifest("https://example.org/data/", ok)).schema_version).toBe("1.1.0");
  });
});
