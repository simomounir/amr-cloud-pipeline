import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadStudies, loadStudyInfo } from "../src/data/studies";
import { baseViewsSql } from "../src/data/tables";

const DATA = new URL("./fixtures/data/", import.meta.url);
const fileFetch = (async (url: string | URL) => {
  try {
    return new Response(await readFile(fileURLToPath(url)));
  } catch {
    return new Response("", { status: 404 });
  }
}) as typeof fetch;

describe("studies", () => {
  it("lists the pinned studies in order", async () => {
    expect((await loadStudies(DATA.href, fileFetch)).map((s) => s.study)).toEqual(["study-a", "study-b"]);
  });
  it("loads a study's story and facts", async () => {
    const info = await loadStudyInfo(DATA.href, "study-a", fileFetch);
    expect(info?.findings.map((f) => f.figure)).toContain("heatmap");
    expect(info?.agreement?.st).toEqual({ agree: 5, total: 6 });
  });
  it("returns null for a release without study.json", async () => {
    expect(await loadStudyInfo(DATA.href, "no-such-study", fileFetch)).toBeNull();
  });
  it("refuses study names that are not slugs", () => {
    expect(() => baseViewsSql(["ok", "x'); DROP"], (s, t) => `${s}/${t}`)).toThrow(/study name/);
  });
});
