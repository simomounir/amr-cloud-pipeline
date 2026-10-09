import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { StatTiles } from "../src/components/StatTiles";
import { StudyCard } from "../src/components/StudyCard";
import type { StudyInfo } from "../src/data/studies";
import { Home } from "../src/pages/Home";
import { Method } from "../src/pages/Method";

const info = (study: string, analysed: number, cost: number | null, agree = 0, total = 0): StudyInfo => ({
  study,
  title: `Title of ${study}`,
  question: `Question of ${study}?`,
  focus: "f",
  background: [],
  findings: [{ id: "f1", figure: null, title: `Finding of ${study}`, text: "t" }],
  reference: null,
  run: { run_id: "r", selected: analysed, analysed, failed: [], cost_usd: cost, cost_per_genome_usd: null, instance_hours: null, wall_time_minutes: null },
  agreement: total
    ? { st: { agree, total }, carbapenemase_family: { agree, total }, family_matrix: [], disagreements: [] }
    : null,
  versions: { amrfinder: [], amrfinder_db: [] },
});

test("StudyCard for a study that failed to load shows the error and no link", () => {
  const html = renderToStaticMarkup(<StudyCard study="broken" info={null} error="manifest.json: HTTP 404" />);
  expect(html).toContain("<h3>broken</h3>");
  expect(html).toContain('role="alert"');
  expect(html).toContain("This study could not be loaded: manifest.json: HTTP 404");
  expect(html).not.toContain("<a ");
});

test("StudyCard for a study that predates study pages links to it and says to republish", () => {
  const html = renderToStaticMarkup(<StudyCard study="old-one" info={null} />);
  expect(html).toContain('href="#/study/old-one"');
  expect(html).toContain(">old-one</a>");
  expect(html).toContain("predates study pages");
  expect(html).not.toContain("Key finding");
});

test("StudyCard with a study.json shows the question, key finding and cost per analysed genome", () => {
  const html = renderToStaticMarkup(<StudyCard study="s" info={info("s", 4, 2)} />);
  expect(html).toContain("Title of s");
  expect(html).toContain("Question of s?");
  expect(html).toContain("Finding of s");
  expect(html).toContain("4 genomes analysed · $0.500 per analysed genome");
});

test("StatTiles sums the studies it is given, with the median cost and pooled agreement", () => {
  const html = renderToStaticMarkup(
    <StatTiles infos={[info("a", 100, 3, 9, 10), info("b", 50, 5, 0, 10), info("c", 50, null)]} studyCount={3} />,
  );
  expect(html).toContain('data-testid="tile-genomes">200<');
  expect(html).toContain('data-testid="tile-cost">$0.065<'); // median of $0.030 and $0.100 (c has no cost)
  expect(html).toContain('data-testid="tile-agreement">45%<');
  expect(html).toContain('data-testid="tile-studies">3<');
});

test("StatTiles without any reference calls or cost says n/a", () => {
  const html = renderToStaticMarkup(<StatTiles infos={[]} studyCount={0} />);
  expect(html).toContain('data-testid="tile-genomes">0<');
  expect(html).toContain('data-testid="tile-cost">n/a<');
  expect(html).toContain('data-testid="tile-agreement">n/a<');
});

test("Home skips studies without study.json in the tiles but still counts and lists them", () => {
  const studies = [
    { study: "a", release: "r" },
    { study: "old", release: "r" },
  ];
  const html = renderToStaticMarkup(<Home studies={studies} infos={{ a: info("a", 7, 7), old: null }} failed={[{ study: "bad", error: "boom" }]} />);
  expect(html).toContain('data-testid="tile-genomes">7<');
  expect(html).toContain('data-testid="tile-studies">3<');
  expect(html).toContain("predates study pages");
  expect(html).toContain("This study could not be loaded: boom");
});

test("the Method page names the AMRFinderPlus database only when its version is known", () => {
  const withVersions = (db: string[]) => ({ a: { ...info("a", 1, 1), versions: { amrfinder: ["4.0.23"], amrfinder_db: db } } });
  const studies = [{ study: "a", release: "r" }];
  const known = renderToStaticMarkup(<Method studies={studies} infos={withVersions(["2025-01-01.1"])} />);
  expect(known).toContain("; version 4.0.23, database 2025-01-01.1.");
  const unknown = renderToStaticMarkup(<Method studies={studies} infos={withVersions([])} />);
  expect(unknown).toContain("; version 4.0.23.");
  expect(unknown).not.toContain("database");
});
