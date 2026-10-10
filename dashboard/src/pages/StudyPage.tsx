import { type ReactNode, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgreementMatrix } from "../components/AgreementMatrix";
import { FigureFrame, type FigureTable } from "../components/FigureFrame";
import { FilterChips } from "../components/FilterChips";
import { Heatmap } from "../components/Heatmap";
import { IsolateTable } from "../components/IsolateTable";
import { Panel } from "../components/Panel";
import { Predates } from "../components/Predates";
import { PeriodBars } from "../components/PeriodBars";
import { RichText } from "../components/RichText";
import { Timeline } from "../components/Timeline";
import type { Connection } from "../data/connection";
import { formatCostPerGenome, mapCaption } from "../data/format";
import { EMPTY_FILTERS, type Filters } from "../data/filters";
import * as q from "../data/queries";
import type { Finding, StudyEntry, StudyInfo } from "../data/studies";
import { toHash } from "../state/url";
import type { Theme } from "../theme";
import { useDashboard } from "../useDashboard";

// world-atlas is large; load it only when a study has a map finding.
const CountryMap = lazy(() => import("../components/CountryMap").then((m) => ({ default: m.CountryMap })));

const pct = (share: number) => `${Math.round(share * 100)}%`;
const same = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Runs `load` whenever `key` changes; keeps the last result while the next one loads. */
function useQuery<T>(conn: Connection, key: string, load: () => Promise<T>): { data?: T; error?: string } {
  const [state, setState] = useState<{ data?: T; error?: string }>({});
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let cancelled = false;
    loadRef.current().then(
      (data) => !cancelled && setState({ data }),
      (e: unknown) => !cancelled && setState({ error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      cancelled = true;
    };
  }, [conn, key]);
  return state;
}

/**
 * What the finding figures read: the whole study, narrowed only by year bounds and the QC toggle.
 * Picks set the other filters, which drive the linked views and the table; the figures only
 * highlight the current selection, so a pick in one figure never reshapes another.
 */
function figureFilters(studyFilters: Filters): Filters {
  const { studies, yearMin, yearMax, hideQcWarnings } = studyFilters;
  return { ...EMPTY_FILTERS, studies, yearMin, yearMax, hideQcWarnings };
}

function FigureError({ error }: { error: string }) {
  return (
    <p className="panel-error" role="alert">
      Could not load this figure: {error}
    </p>
  );
}

function HeatmapFigure({ conn, studyFilters, filters, setFilters, theme }: FigureProps) {
  const [byPeriod, setByPeriod] = useState(false);
  const read = useMemo(() => figureFilters(studyFilters), [studyFilters]);
  const { data: loaded, error } = useQuery(conn, JSON.stringify([read, byPeriod]), async () => ({
    cells: await q.familyHeatmap(conn, read, byPeriod),
    n: await q.cohortGenomeCount(conn, read, byPeriod),
  }));
  const data = loaded?.cells;
  const latest = useRef(filters);
  latest.current = filters;
  const onPick = useCallback(
    (clone: string, family: string) => {
      const f = latest.current;
      const again = same(f.clones, [clone]) && same(f.families, [family]);
      setFilters({ ...f, includeIntrinsic: false, clones: again ? [] : [clone], families: again ? [] : [family] });
    },
    [setFilters],
  );
  const selected = useMemo(() => ({ clone: filters.clones[0], family: filters.families[0] }), [filters.clones, filters.families]);
  const table = useMemo<FigureTable>(
    () => ({
      columns: ["Clone", "Period", "Carbapenemase family", "Carriers", "Genomes", "Share"],
      rows: (data ?? []).map((c) => [c.clone, c.period, c.family, c.carriers, c.genomes, pct(c.share)]),
      pick: {
        label: (row) => `Select ${row[0]} carrying ${row[2]}`,
        onPick: (row) => onPick(String(row[0]), String(row[2])),
      },
    }),
    [data, onPick],
  );
  const n = loaded?.n ?? 0;
  if (error) return <FigureError error={error} />;
  return (
    <FigureFrame figure="heatmap" title="Carbapenemase family by clone" caption={`n = ${n} genomes. A genome can carry more than one family, so a row can add up to more than 100%.`} table={table}>
      {data && (
        <Heatmap cells={data} selected={selected} onPick={onPick} byPeriod={byPeriod} onByPeriod={setByPeriod} theme={theme} />
      )}
    </FigureFrame>
  );
}

function PeriodsFigure({ conn, studyFilters, filters, setFilters, theme }: FigureProps) {
  const read = useMemo(() => figureFilters(studyFilters), [studyFilters]);
  const { data, error } = useQuery(conn, JSON.stringify(read), () => q.periodMix(conn, read));
  const latest = useRef(filters);
  latest.current = filters;
  const onPick = useCallback(
    (clone: string, period: string, combo: string) => {
      const f = latest.current;
      const again = same(f.clones, [clone]) && same(f.periods, [period]) && same(f.combos, [combo]);
      setFilters({ ...f, includeIntrinsic: false, clones: again ? [] : [clone], periods: again ? [] : [period], combos: again ? [] : [combo] });
    },
    [setFilters],
  );
  const selected = useMemo(
    () => ({ clones: filters.clones, periods: filters.periods, combos: filters.combos, families: filters.families }),
    [filters.clones, filters.periods, filters.combos, filters.families],
  );
  const table = useMemo<FigureTable>(
    () => ({
      columns: ["Clone", "Period", "Carbapenemase combination", "Genomes", "Share of clone and period"],
      rows: (data ?? []).map((r) => [r.clone, r.period, r.combo, r.genomes, pct(r.share)]),
      pick: {
        label: (row) => `Select ${row[0]}, ${row[1]}, ${row[2]}`,
        onPick: (row) => onPick(String(row[0]), String(row[1]), String(row[2])),
      },
    }),
    [data, onPick],
  );
  if (error) return <FigureError error={error} />;
  const n = (data ?? []).reduce((sum, r) => sum + r.genomes, 0);
  return (
    <FigureFrame figure="periods" title="Carbapenemase mix by clone and period" caption={`n = ${n} genomes`} table={table}>
      {data && <PeriodBars rows={data} selected={selected} onPick={onPick} theme={theme} />}
    </FigureFrame>
  );
}

function MapFigure({ conn, studyFilters, filters, setFilters }: FigureProps) {
  const read = useMemo(() => figureFilters(studyFilters), [studyFilters]);
  const { data, error } = useQuery(conn, JSON.stringify(read), async () => ({
    rows: await q.countryCounts(conn, read),
    noCountry: await q.noCountryCount(conn, read),
  }));
  const latest = useRef(filters);
  latest.current = filters;
  const onPick = useCallback(
    (country: string) => {
      const f = latest.current;
      setFilters({ ...f, includeIntrinsic: false, countries: same(f.countries, [country]) ? [] : [country] });
    },
    [setFilters],
  );
  const table = useMemo<FigureTable>(
    () => ({
      columns: ["Country", "Genomes", "Clones", "Carbapenemases"],
      rows: (data?.rows ?? []).map((r) => [r.country, r.genomes, r.clones, r.families]),
      pick: { label: (row) => `Select ${row[0]}`, onPick: (row) => onPick(String(row[0])) },
    }),
    [data, onPick],
  );
  if (error) return <FigureError error={error} />;
  const mapped = (data?.rows ?? []).reduce((sum, r) => sum + r.genomes, 0);
  const noCountry = data?.noCountry ?? 0;
  const caption = mapCaption(mapped, noCountry);
  return (
    <FigureFrame figure="map" title="Where the genomes come from" caption={caption} table={table}>
      {data && (
        <Suspense fallback={<p className="note">Loading map…</p>}>
          <CountryMap rows={data.rows} selected={filters.countries} onPick={onPick} />
        </Suspense>
      )}
    </FigureFrame>
  );
}

function AgreementFigure({ info, theme }: { info: StudyInfo; theme: Theme }) {
  const agreement = info.agreement;
  const table = useMemo<FigureTable>(
    () => ({
      columns: ["Our call", "Reference call", "Genomes"],
      rows: (agreement?.family_matrix ?? []).map((c) => [c.ours, c.reference, c.genomes]),
    }),
    [agreement],
  );
  // The full name (with snapshot) is in How we know; figure labels use the short name.
  const referenceName = (info.reference?.name ?? "reference").split(" (")[0];
  return (
    <FigureFrame
      figure="agreement"
      title={`Our carbapenemase calls against ${referenceName}`}
      caption={`n = ${agreement?.carbapenemase_family.total ?? 0} genomes`}
      table={table}
    >
      <AgreementMatrix agreement={agreement} referenceName={referenceName} theme={theme} />
    </FigureFrame>
  );
}

interface FigureProps {
  conn: Connection;
  /** The study's filters with `studies` fixed to this study. */
  studyFilters: Filters;
  /** The filters as they appear in the URL (no forced study), for picks to extend. */
  filters: Filters;
  setFilters: (f: Filters) => void;
  theme: Theme;
}

function FindingFigure({ finding, info, props, hasCohort }: { finding: Finding; info: StudyInfo; props: FigureProps; hasCohort: boolean }) {
  if ((finding.figure === "heatmap" || finding.figure === "periods") && !hasCohort) {
    return <p className="note">This study has no clone/period design variables.</p>;
  }
  switch (finding.figure) {
    case "heatmap":
      return <HeatmapFigure {...props} />;
    case "periods":
      return <PeriodsFigure {...props} />;
    case "map":
      return <MapFigure {...props} />;
    case "agreement":
      return <AgreementFigure info={info} theme={props.theme} />;
    default:
      return null;
  }
}

const num = (v: number | null, digits = 2) => (v === null ? "not recorded" : v.toFixed(digits));

/** Run facts as one line of metadata: they matter for checking, not for the story. */
function RunFacts({ info }: { info: StudyInfo }) {
  const { run, versions } = info;
  const parts: ReactNode[] = [];
  if (run.cost_usd !== null) parts.push(`$${num(run.cost_usd)} total`);
  if (run.cost_usd !== null) parts.push(`${formatCostPerGenome(run)} per analysed genome`);
  if (run.instance_hours !== null) parts.push(`${num(run.instance_hours, 1)} instance-hours`);
  if (run.wall_time_minutes !== null) parts.push(`${num(run.wall_time_minutes, 0)} min pipeline wall time`);
  if (versions.amrfinder.length > 0) {
    const db = versions.amrfinder_db.join(", ");
    parts.push(`AMRFinderPlus ${versions.amrfinder.join(", ")}${db ? ` (database ${db})` : ""}`);
  }
  parts.push(
    <>
      Nextflow session <code>{run.run_id}</code>
    </>,
  );
  return (
    <p className="facts-line">
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && <span aria-hidden="true"> · </span>}
          {part}
        </span>
      ))}
    </p>
  );
}

function HowWeKnow({ info, hasAgreementFigure }: { info: StudyInfo; hasAgreementFigure: boolean }) {
  const { run, agreement, reference } = info;
  return (
    <section className="how-we-know" aria-labelledby="how-we-know-h">
      <h2 id="how-we-know-h">How we know</h2>
      <p>
        {run.selected} genomes were selected and {run.analysed} analysed
        {run.failed.length > 0 ? `; ${run.failed.length} failed assembly and appear in no figure or table: ` : "."}
        {run.failed.map((s, i) => (
          <span key={s}>
            {i > 0 && ", "}
            <code>{s}</code>
          </span>
        ))}
        {run.failed.length > 0 && "."}
      </p>
      {reference && agreement && (
        <p>
          Against {reference.name}, {agreement.st.agree} of {agreement.st.total} sequence types and{" "}
          {agreement.carbapenemase_family.agree} of {agreement.carbapenemase_family.total} carbapenemase families agree
          {hasAgreementFigure ? " (the differences are listed under the agreement finding)." : "."}
          {(agreement.not_in_reference ?? []).length > 0 &&
            ` Not compared, because the reference has no row for them: ${(agreement.not_in_reference ?? []).join(", ")}.`}
        </p>
      )}
      {reference && agreement && !hasAgreementFigure && agreement.disagreements.length > 0 && (
        <ul>
          {agreement.disagreements.map((d) => (
            <li key={`${d.sample}:${d.field}`}>
              <code>{d.sample}</code>, {d.field === "st" ? "sequence type" : "carbapenemase family"}: we call{" "}
              {d.ours ?? "nothing"}, {reference.name} calls {d.reference ?? "nothing"}.
            </li>
          ))}
        </ul>
      )}
      {info.caveats && info.caveats.length > 0 && (
        <>
          <h3>Caveats</h3>
          {info.caveats.map((p, i) => (
            <p key={i}>
              <RichText text={p} />
            </p>
          ))}
        </>
      )}
      <h3>Run</h3>
      <RunFacts info={info} />
    </section>
  );
}

const PICK_KEYS = ["clones", "periods", "families", "combos", "countries"] as const;
const hasSelection = (f: Filters) => PICK_KEYS.some((k) => f[k].length > 0);

/** Keeps the current selection in view while the reader moves through the findings. */
function SelectionBar({
  filters,
  setFilters,
  genomes,
}: {
  filters: Filters;
  setFilters: (f: Filters) => void;
  genomes: number | undefined;
}) {
  const picked = hasSelection(filters);
  const set = (f: Filters) => setFilters({ ...f, includeIntrinsic: false });
  return (
    <div className="selection-bar" role="region" aria-label="Selection">
      <div className="selection-main" aria-live="polite">
        {picked ? (
          <>
            <FilterChips filters={filters} onChange={set} />
            <span className="selection-count">
              {genomes === undefined ? "…" : `${genomes} ${genomes === 1 ? "genome" : "genomes"}`}
            </span>
            <a className="selection-jump" href="#genomes" onClick={(e) => {
              e.preventDefault();
              document.getElementById("genomes")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}>
              See them ↓
            </a>
          </>
        ) : (
          <span className="selection-hint">Click a cell, bar or dot to see the genomes behind it.</span>
        )}
      </div>
      <label className="selection-qc">
        <input
          type="checkbox"
          checked={!filters.hideQcWarnings}
          onChange={(e) => set({ ...filters, hideQcWarnings: !e.target.checked })}
        />{" "}
        Include genomes with QC warnings
      </label>
    </div>
  );
}

function GenomesBehind({
  data,
  clear,
  theme,
}: {
  data: ReturnType<typeof useDashboard>["data"];
  clear: () => void;
  theme: Theme;
}) {
  if (!data) {
    return (
      <div className="skeleton" aria-busy="true">
        Loading…
      </div>
    );
  }
  const empty = data.headline.data?.isolates === 0;
  return (
    <>
      <Panel title="Carbapenemase families over time" error={data.timeline.error} empty={empty} onClear={clear}>
        {data.timeline.data && <Timeline rows={data.timeline.data} theme={theme} />}
      </Panel>
      <Panel title="Genomes" error={data.isolates.error} empty={empty} onClear={clear}>
        {data.isolates.data && <IsolateTable rows={data.isolates.data} />}
      </Panel>
    </>
  );
}

function StudyBody({
  conn,
  study,
  info,
  hasCohort,
  filters,
  setFilters,
  theme,
}: {
  conn: Connection;
  study: string;
  info: StudyInfo | null;
  hasCohort: boolean;
  filters: Filters;
  setFilters: (f: Filters) => void;
  theme: Theme;
}) {
  const studyFilters = useMemo(() => ({ ...filters, studies: [study] }), [filters, study]);
  const props: FigureProps = { conn, studyFilters, filters, setFilters, theme };
  const { data } = useDashboard(conn, studyFilters, false);
  const clear = useCallback(
    () => setFilters({ ...EMPTY_FILTERS, hideQcWarnings: studyFilters.hideQcWarnings, includeIntrinsic: false }),
    [setFilters, studyFilters.hideQcWarnings],
  );
  const genomes = data?.headline.data?.isolates;
  const hasAgreementFigure = info?.findings.some((f) => f.figure === "agreement") ?? false;
  return (
    <article className="study">
      <header className="page-head">
        <h1>{info?.title ?? study}</h1>
        {info ? <p className="question">{info.question}</p> : <Predates />}
      </header>
      {info?.background.map((p, i) => (
        <p key={i} className="background">
          <RichText text={p} />
        </p>
      ))}
      <section className="findings" aria-labelledby="findings-h">
        <h2 id="findings-h">Findings</h2>
        <SelectionBar filters={filters} setFilters={setFilters} genomes={genomes} />
        {info?.findings.map((f, i) => (
          <section key={f.id} id={f.id} className="finding">
            <h3>
              {i + 1}. {f.title}
            </h3>
            <p>
              <RichText text={f.text} />
            </p>
            <FindingFigure finding={f} info={info} props={props} hasCohort={hasCohort} />
          </section>
        ))}
      </section>
      {info?.meaning && info.meaning.length > 0 && (
        <section className="meaning" aria-labelledby="meaning-h">
          <h2 id="meaning-h">What this means</h2>
          {info.meaning.map((p, i) => (
            <p key={i}>
              <RichText text={p} />
            </p>
          ))}
        </section>
      )}
      <section id="genomes" className="genomes" aria-labelledby="genomes-h">
        <h2 id="genomes-h">Genomes behind your selection</h2>
        <p className="note">
          {genomes === undefined
            ? "Loading…"
            : `${genomes} ${genomes === 1 ? "genome" : "genomes"}${hasSelection(filters) ? " match the selection above" : " in this study"}.`}
        </p>
        <GenomesBehind data={data} clear={clear} theme={theme} />
      </section>
      {info && <HowWeKnow info={info} hasAgreementFigure={hasAgreementFigure} />}
    </article>
  );
}

export function StudyPage({
  conn,
  study,
  studies,
  infos,
  hasCohort,
  failed,
  filters,
  setFilters,
  theme,
}: {
  conn: Connection;
  study: string;
  studies: StudyEntry[];
  infos: Record<string, StudyInfo | null>;
  /** Per study: whether it has a cohort table (clone and period). */
  hasCohort: Record<string, boolean>;
  failed: { study: string; error: string }[];
  filters: Filters;
  setFilters: (f: Filters) => void;
  theme: Theme;
}) {
  if (!studies.some((s) => s.study === study)) {
    const loadError = failed.find((f) => f.study === study);
    return (
      <div className="page-head">
        {loadError ? (
          <>
            <h1>{study} could not be loaded</h1>
            <p role="alert">{loadError.error}</p>
          </>
        ) : (
          <>
            <h1>No such study</h1>
            <p>There is no study called <code>{study}</code>.</p>
          </>
        )}
        <p>
          <a href={toHash({ page: "home" })}>Back to the home page</a>.
        </p>
      </div>
    );
  }
  return <StudyBody conn={conn} study={study} info={infos[study] ?? null} hasCohort={hasCohort[study] ?? false} filters={filters} setFilters={setFilters} theme={theme} />;
}
