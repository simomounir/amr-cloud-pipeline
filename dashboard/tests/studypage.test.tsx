import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { EMPTY_FILTERS } from "../src/data/filters";
import { StudyPage } from "../src/pages/StudyPage";

const base = {
  conn: { query: async () => [] },
  studies: [{ study: "ok", release: "dataset-ok-2026-10-01" }],
  infos: {},
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
