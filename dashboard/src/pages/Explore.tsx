import { useState } from "react";
import { FilterBar } from "../components/FilterBar";
import { Headline } from "../components/Headline";
import { IsolateTable } from "../components/IsolateTable";
import { Panel } from "../components/Panel";
import { Timeline } from "../components/Timeline";
import { TopElements } from "../components/TopElements";
import type { Connection } from "../data/connection";
import { EMPTY_FILTERS, type Filters } from "../data/filters";
import type { Theme } from "../theme";
import { useDashboard } from "../useDashboard";

export function Explore({
  conn,
  filters,
  setFilters,
  theme,
}: {
  conn: Connection;
  filters: Filters;
  setFilters: (f: Filters) => void;
  theme: Theme;
}) {
  const [includeIntrinsic, setIncludeIntrinsic] = useState(false);
  const { data, years } = useDashboard(conn, filters, includeIntrinsic);
  const clear = () => setFilters(EMPTY_FILTERS);
  if (!data) {
    return (
      <div className="skeleton" aria-busy="true">
        Loading dataset…
      </div>
    );
  }
  const empty = data.headline.data?.isolates === 0;
  return (
    <div className="layout">
      <FilterBar
        filters={filters}
        onChange={setFilters}
        years={years}
        optionRows={{
          studies: data.studies.data,
          countries: data.countries.data,
          sources: data.sources.data,
          sts: data.sts.data,
        }}
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
      </main>
    </div>
  );
}
