import { useEffect, useState } from "react";
import { FilterBar } from "./components/FilterBar";
import { Footer } from "./components/Footer";
import { Headline } from "./components/Headline";
import { IsolateTable } from "./components/IsolateTable";
import { Panel } from "./components/Panel";
import { Timeline } from "./components/Timeline";
import { TopElements } from "./components/TopElements";
import type { Connection } from "./data/connection";
import { openDashboardDb } from "./data/db";
import { EMPTY_FILTERS } from "./data/filters";
import type { Manifest } from "./data/manifest";
import type { AnalysisCounts } from "./data/queries";
import { useDashboard } from "./useDashboard";

const DATA_URL = new URL("data/", document.baseURI).href;

export function App() {
  const [db, setDb] = useState<{ conn: Connection; manifest: Manifest; tag: string; counts: AnalysisCounts }>();
  const [fatal, setFatal] = useState<string>();
  useEffect(() => {
    openDashboardDb(DATA_URL)
      .then((d) => {
        // Task 6 rebuilds the shell around every study; until then the footer shows the first one.
        const first = d.studies[0];
        setDb({ conn: d.conn, manifest: d.manifests[first.study], tag: first.release, counts: d.counts[first.study] });
      })
      .then(undefined, (e: Error) => setFatal(e.message));
  }, []);
  const { filters, setFilters, includeIntrinsic, setIncludeIntrinsic, data, years } = useDashboard(db?.conn);
  const clear = () => setFilters(EMPTY_FILTERS);
  const empty = data?.headline.data?.isolates === 0;

  return (
    <div className="app">
      <header>
        <h1>AMR Explorer</h1>
        <p>
          Antimicrobial resistance in public <em>Klebsiella pneumoniae</em> genomes, queried in your browser.
        </p>
      </header>
      {fatal ? (
        <p className="fatal" role="alert">
          {fatal}
        </p>
      ) : !db || !data ? (
        <div className="skeleton" aria-busy="true">
          Loading dataset…
        </div>
      ) : (
        <div className="layout">
          <FilterBar
            filters={filters}
            onChange={setFilters}
            years={years}
            optionRows={{ countries: data.countries.data, sources: data.sources.data, sts: data.sts.data }}
          />
          <main>
            <Panel title="Overview" error={data.headline.error}>
              {data.headline.data && <Headline data={data.headline.data} />}
              <p className="note">
                Public genomes over-represent resistant, outbreak-associated isolates; these percentages describe this
                dataset, not prevalence.
              </p>
            </Panel>
            <Panel title="Resistance over time" error={data.timeline.error} empty={empty} onClear={clear}>
              {data.timeline.data && <Timeline rows={data.timeline.data} />}
            </Panel>
            <Panel title="Most common acquired AMR elements" error={data.elements.error} empty={empty} onClear={clear}>
              <label className="panel-option">
                <input
                  type="checkbox"
                  checked={includeIntrinsic}
                  onChange={(e) => setIncludeIntrinsic(e.target.checked)}
                />{" "}
                Include intrinsic genes
              </label>
              {data.elements.data && <TopElements rows={data.elements.data} />}
            </Panel>
            <Panel title="Isolates" error={data.isolates.error} empty={empty} onClear={clear}>
              {data.isolates.data && <IsolateTable rows={data.isolates.data} />}
            </Panel>
          </main>
        </div>
      )}
      {db && <Footer manifest={db.manifest} tag={db.tag} counts={db.counts} />}
    </div>
  );
}
