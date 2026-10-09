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
import { TopElements } from "../components/TopElements";
import type { Connection } from "../data/connection";
import { formatCostPerGenome } from "../data/format";
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
      setFilters({ ...f, clones: again ? [] : [clone], families: again ? [] : [family] });
    },
    [setFilters],
  );
  const selected = useMemo(() => ({ clone: filters.clones[0], family: filters.families[0] }), [filters.clones, filters.families]);
  const table = useMemo<FigureTable>(
    () => ({
      columns: ["Clone", "Period", "Carbapenemase family", "Carriers", "Genomes", "Share"],
      rows: (data ?? []).map((c) => [c.clone, c.period, c.family, c.carriers, c.genomes, pct(c.share)]),
    }),
    [data],
  );
  const n = loaded?.n ?? 0;
  if (error) return <FigureError error={error} />;
  return (
    <FigureFrame figure="heatmap" title="Carbapenemase family by clone" caption={`n = ${n} genomes`} table={table}>
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
      setFilters({ ...f, clones: again ? [] : [clone], periods: again ? [] : [period], combos: again ? [] : [combo] });
    },
    [setFilters],
  );
  const selected = useMemo(
    () => ({ clones: filters.clones, periods: filters.periods, combos: filters.combos }),
    [filters.clones, filters.periods, filters.combos],
  );
  const table = useMemo<FigureTable>(
    () => ({
      columns: ["Clone", "Period", "Carbapenemase combination", "Genomes", "Share of clone and period"],
      rows: (data ?? []).map((r) => [r.clone, r.period, r.combo, r.genomes, pct(r.share)]),
    }),
    [data],
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
      setFilters({ ...f, countries: same(f.countries, [country]) ? [] : [country] });
    },
    [setFilters],
  );
  const table = useMemo<FigureTable>(
    () => ({
      columns: ["Country", "Genomes", "Clones", "Carbapenemases"],
      rows: (data?.rows ?? []).map((r) => [r.country, r.genomes, r.clones, r.families]),
    }),
    [data],
  );
  if (error) return <FigureError error={error} />;
  const mapped = (data?.rows ?? []).reduce((sum, r) => sum + r.genomes, 0);
  const noCountry = data?.noCountry ?? 0;
  const caption =
    `n = ${mapped + noCountry} genomes; ${noCountry} ${noCountry === 1 ? "genome has" : "genomes have"} no country ` +
    "in their ENA record and are not mapped. Country as recorded in ENA; the source table assigns countries to all genomes.";
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
  const referenceName = info.reference?.name ?? "reference";
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

function HowWeKnow({ info }: { info: StudyInfo }) {
  const { run, agreement, reference, versions } = info;
  const rows: [string, ReactNode][] = [
    ["Total cost", run.cost_usd === null ? "not recorded" : `$${num(run.cost_usd)}`],
    ["Cost per analysed genome", formatCostPerGenome(run)],
    ["Instance-hours", num(run.instance_hours)],
    ["Pipeline wall time (first task to last)", run.wall_time_minutes === null ? "not recorded" : `${num(run.wall_time_minutes, 0)} minutes`],
    ["Nextflow session", <code key="session">{run.run_id}</code>],
    ["AMRFinderPlus", versions.amrfinder.join(", ") || "unknown"],
    ["AMRFinderPlus database", versions.amrfinder_db.join(", ") || "unknown"],
  ];
  return (
    <section className="how-we-know" aria-labelledby="how-we-know-h">
      <h2 id="how-we-know-h">How we know</h2>
      <h3>Cohort</h3>
      <p>
        {run.selected} genomes were selected, {run.analysed} were analysed
        {run.failed.length > 0 ? ` and ${run.failed.length} failed analysis: ` : "."}
        {run.failed.map((s, i) => (
          <span key={s}>
            {i > 0 && ", "}
            <code>{s}</code>
          </span>
        ))}
        {run.failed.length > 0 && ". Failed genomes appear in no figure or table."}
      </p>
      {reference && agreement && (
        <>
          <h3>Agreement with {reference.name}</h3>
          <p>
            Sequence type: {agreement.st.agree} of {agreement.st.total} genomes agree. Carbapenemase family:{" "}
            {agreement.carbapenemase_family.agree} of {agreement.carbapenemase_family.total} agree.
          </p>
          {(agreement.not_in_reference ?? []).length > 0 && (
            <p>
              Not compared, because {reference.name} has no row for them:{" "}
              {(agreement.not_in_reference ?? []).join(", ")}.
            </p>
          )}
          {agreement.disagreements.length > 0 && (
            <ul>
              {agreement.disagreements.map((d) => (
                <li key={`${d.sample}:${d.field}`}>
                  <code>{d.sample}</code>, {d.field === "st" ? "sequence type" : "carbapenemase family"}: we call{" "}
                  {d.ours ?? "nothing"}, {reference.name} calls {d.reference ?? "nothing"}.
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <h3>Run facts</h3>
      <dl className="facts">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
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
    </section>
  );
}

function LinkedViews({ conn, studyFilters, setFilters, theme }: Omit<FigureProps, "filters">) {
  const [includeIntrinsic, setIncludeIntrinsic] = useState(false);
  const { data } = useDashboard(conn, studyFilters, includeIntrinsic);
  const clear = useCallback(() => setFilters({ ...EMPTY_FILTERS, hideQcWarnings: studyFilters.hideQcWarnings }), [setFilters, studyFilters.hideQcWarnings]);
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
      <Panel title="Resistance over time" error={data.timeline.error} empty={empty} onClear={clear}>
        {data.timeline.data && <Timeline rows={data.timeline.data} theme={theme} />}
      </Panel>
      <Panel title="Most common acquired AMR elements" error={data.elements.error} empty={empty} onClear={clear}>
        <label className="panel-option">
          <input type="checkbox" checked={includeIntrinsic} onChange={(e) => setIncludeIntrinsic(e.target.checked)} />{" "}
          Include intrinsic genes
        </label>
        {data.elements.data && <TopElements rows={data.elements.data} />}
      </Panel>
      <Panel title="Isolates" error={data.isolates.error} empty={empty} onClear={clear}>
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
  return (
    <article className="study">
      <header className="page-head">
        <h1>{info?.title ?? study}</h1>
        {info ? <p className="question">{info.question}</p> : <Predates />}
      </header>
      {info && (
        <>
          {info.background.map((p, i) => (
            <p key={i} className="background">
              <RichText text={p} />
            </p>
          ))}
          <h2>Findings</h2>
          {info.findings.map((f, i) => (
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
        </>
      )}
      <label className="panel-option qc-toggle">
        <input
          type="checkbox"
          checked={!filters.hideQcWarnings}
          onChange={(e) => setFilters({ ...filters, hideQcWarnings: !e.target.checked })}
        />{" "}
        Include genomes with QC warnings
      </label>
      <div className="sticky-chips">
        <FilterChips filters={filters} onChange={setFilters} />
      </div>
      <h2>Linked views</h2>
      <LinkedViews conn={conn} studyFilters={studyFilters} setFilters={setFilters} theme={theme} />
      {info && <HowWeKnow info={info} />}
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
