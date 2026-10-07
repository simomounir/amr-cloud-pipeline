import { useEffect, useState } from "react";
import { FilterBar } from "./components/FilterBar";
import { Footer } from "./components/Footer";
import { Headline } from "./components/Headline";
import { Heatmap } from "./components/Heatmap";
import { IsolateTable } from "./components/IsolateTable";
import { Panel } from "./components/Panel";
import { Timeline } from "./components/Timeline";
import type { Connection } from "./data/connection";
import { openDashboardDb } from "./data/db";
import { EMPTY_FILTERS } from "./data/filters";
import type { Manifest } from "./data/manifest";
import { useDashboard } from "./useDashboard";

const DATA_URL = new URL("data/", document.baseURI).href;

export function App() {
  const [db, setDb] = useState<{ conn: Connection; manifest: Manifest; tag: string }>();
  const [fatal, setFatal] = useState<string>();
  useEffect(() => {
    openDashboardDb(DATA_URL).then(setDb, (e: Error) => setFatal(e.message));
  }, []);
  const { filters, setFilters, data, years } = useDashboard(db?.conn);
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
            </Panel>
            <Panel title="Resistance over time" error={data.timeline.error} empty={empty} onClear={clear}>
              {data.timeline.data && <Timeline rows={data.timeline.data} />}
            </Panel>
            <Panel title="Most common AMR elements" error={data.heatmap.error} empty={empty} onClear={clear}>
              {data.heatmap.data && <Heatmap rows={data.heatmap.data} />}
            </Panel>
            <Panel title="Isolates" error={data.isolates.error} empty={empty} onClear={clear}>
              {data.isolates.data && <IsolateTable rows={data.isolates.data} />}
            </Panel>
          </main>
        </div>
      )}
      {db && <Footer manifest={db.manifest} tag={db.tag} />}
    </div>
  );
}
