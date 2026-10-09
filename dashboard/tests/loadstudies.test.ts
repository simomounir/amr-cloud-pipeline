import { expect, it } from "vitest";
import { loadAvailableStudies } from "../src/data/loadStudies";

const manifest = JSON.stringify({ schema_version: "1.2.0", created_at: "x", runs: [], tables: {} });
function fetchFor(files: Record<string, string>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const hit = Object.entries(files).find(([suffix]) => url.endsWith(suffix));
    return hit ? new Response(hit[1]) : url.endsWith(".parquet") ? new Response("PAR1....") : new Response("", { status: 404 });
  }) as typeof fetch;
}

const listed = [
  { study: "good", release: "dataset-good-2026-10-01" },
  { study: "badjson", release: "dataset-badjson-2026-10-01" },
  { study: "badtable", release: "dataset-badtable-2026-10-01" },
];
const files = {
  "good/manifest.json": manifest,
  "good/study.json": '{"study":"good"}',
  "badjson/manifest.json": manifest,
  "badjson/study.json": "{ not json",
  "badtable/manifest.json": manifest,
  "badtable/study.json": '{"study":"badtable"}',
};

it("a study with invalid study.json or unreadable tables is reported as failed; the rest load", async () => {
  const registered: string[] = [];
  const result = await loadAvailableStudies("https://x.org/data/", listed, {
    register: async (study, table) => void registered.push(`${study}:${table}`),
    probe: async (study, table) => {
      if (study === "badtable" && table === "amr_genes") throw new Error("amr_genes.parquet: corrupt footer");
    },
  }, fetchFor(files));
  expect(result.loaded.map((l) => l.study)).toEqual(["good"]);
  expect(result.loaded[0].info).toEqual({ study: "good" });
  expect(result.loaded[0].hasCohort).toBe(true);
  expect(result.failed.map((f) => f.study)).toEqual(["badjson", "badtable"]);
  expect(result.failed[0].error).toMatch(/study\.json/);
  expect(result.failed[1].error).toContain("corrupt footer");
  expect(registered).toContain("good:samples");
});

it("a missing manifest fails only that study", async () => {
  const result = await loadAvailableStudies("https://x.org/data/", listed.slice(0, 1), {
    register: async () => undefined,
    probe: async () => undefined,
  }, fetchFor({}));
  expect(result.loaded).toEqual([]);
  expect(result.failed[0].error).toContain("manifest.json");
});

it("a study name that is not a slug fails before any URL or SQL is built", async () => {
  const urls: string[] = [];
  const spy = (async (input: string | URL | Request) => {
    urls.push(String(input));
    return new Response("", { status: 404 });
  }) as typeof fetch;
  const hooks = { register: async () => undefined, probe: async () => undefined };
  const result = await loadAvailableStudies("https://x.org/data/", [
    { study: "../evil", release: "r" },
    { study: "a'b", release: "r" },
  ], hooks, spy);
  expect(result.loaded).toEqual([]);
  expect(result.failed.map((f) => f.study)).toEqual(["../evil", "a'b"]);
  expect(result.failed[0].error).toMatch(/Invalid study name/);
  expect(urls).toEqual([]);
});
