import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { EMPTY_FILTERS } from "../src/data/filters";
import type { StudyInfo } from "../src/data/studies";
import { StudyPage } from "../src/pages/StudyPage";

const base = {
  conn: { query: async () => [] },
  studies: [{ study: "ok", release: "dataset-ok-2026-10-01" }],
  infos: {},
  hasCohort: { ok: true },
  filters: EMPTY_FILTERS,
  setFilters: () => undefined,
  theme: "light" as const,
};

test("a study whose release failed to load shows its load error, not 'No such study'", () => {
  const html = renderToStaticMarkup(
    <StudyPage {...base} study="broken" failed={[{ study: "broken", error: "manifest.json: HTTP 404" }]} />,
  );
  expect(html).toContain("broken could not be loaded");
  expect(html).toContain("manifest.json: HTTP 404");
  expect(html).not.toContain("No such study");
});

test("an unknown study is reported as such", () => {
  expect(renderToStaticMarkup(<StudyPage {...base} study="nope" failed={[]} />)).toContain("No such study");
});

const info: StudyInfo = {
  study: "ok",
  title: "OK study",
  question: "Q?",
  focus: "f",
  background: [],
  findings: [
    { id: "h", figure: "heatmap", title: "Heat", text: "t" },
    { id: "p", figure: "periods", title: "Per", text: "t" },
  ],
  reference: null,
  run: {
    run_id: "20260101-abc",
    selected: 3,
    analysed: 2,
    failed: [],
    cost_usd: 1,
    cost_per_genome_usd: null,
    instance_hours: null,
    wall_time_minutes: 90,
  },
  agreement: null,
  versions: { amrfinder: [], amrfinder_db: [] },
};
const withInfo = { ...base, infos: { ok: info }, failed: [] };

test("a study without clone/period data shows a note instead of empty figures", () => {
  const html = renderToStaticMarkup(<StudyPage {...withInfo} hasCohort={{ ok: false }} study="ok" />);
  expect(html).toContain("This study has no clone/period design variables.");
  expect(html).not.toContain('data-figure="heatmap"');
  expect(html).not.toContain('data-figure="periods"');
  expect(renderToStaticMarkup(<StudyPage {...withInfo} study="ok" />)).toContain('data-figure="heatmap"');
});

test("Run facts: Nextflow session as plain text, cost per analysed genome, wall time", () => {
  const html = renderToStaticMarkup(<StudyPage {...withInfo} study="ok" />);
  expect(html).toContain("Nextflow session");
  expect(html).toContain("<code>20260101-abc</code>");
  expect(html).not.toContain("actions?query");
  expect(html).toContain("$0.500 per analysed genome");
  expect(html).toContain("min pipeline wall time");
});

test("the QC toggle is ticked when warnings are included", () => {
  const on = renderToStaticMarkup(<StudyPage {...withInfo} filters={{ ...EMPTY_FILTERS, hideQcWarnings: false }} study="ok" />);
  const off = renderToStaticMarkup(<StudyPage {...withInfo} study="ok" />);
  expect(on).toMatch(/<input type="checkbox" checked=""[^>]*\/> Include genomes with QC warnings/);
  expect(off).not.toMatch(/checked=""[^>]*\/> Include genomes with QC warnings/);
});

test("the study page ends with What this means before the genomes and How we know", () => {
  const info = { ...withInfo.infos.ok!, meaning: ["Clones pair with *carbapenemases*."] };
  const html = renderToStaticMarkup(<StudyPage {...withInfo} infos={{ ok: info }} study="ok" />);
  const order = ["What this means", "Genomes behind your selection", "How we know"].map((t) => html.indexOf(t));
  expect(order.every((i) => i > 0)).toBe(true);
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(html).toContain("<em>carbapenemases</em>");
});

test("without a selection the bar explains how to pick", () => {
  const html = renderToStaticMarkup(<StudyPage {...withInfo} study="ok" />);
  expect(html).toContain("Click a cell, bar or dot to see the genomes behind it.");
  expect(html).toContain('aria-live="polite"');
});
