import { useEffect, useState } from "react";
import type { Connection } from "./data/connection";
import { EMPTY_FILTERS, type Filters } from "./data/filters";
import * as q from "./data/queries";

export interface PanelState<T> {
  data?: T;
  error?: string;
}
export interface DashboardData {
  headline: PanelState<q.Headline>;
  timeline: PanelState<q.TimelineRow[]>;
  heatmap: PanelState<q.HeatmapRow[]>;
  isolates: PanelState<q.IsolateRow[]>;
  countries: PanelState<q.OptionRow[]>;
  sources: PanelState<q.OptionRow[]>;
  sts: PanelState<q.OptionRow[]>;
}

async function settle<T>(promise: Promise<T>): Promise<PanelState<T>> {
  try {
    return { data: await promise };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export function useDashboard(conn: Connection | undefined) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [data, setData] = useState<DashboardData | undefined>();
  const [years, setYears] = useState<{ min: number | null; max: number | null }>({ min: null, max: null });

  useEffect(() => {
    if (conn) q.yearBounds(conn).then(setYears, () => undefined);
  }, [conn]);

  useEffect(() => {
    if (!conn) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const [headline, timeline, heatmap, isolates, countries, sources, sts] = await Promise.all([
        settle(q.headline(conn, filters)),
        settle(q.timeline(conn, filters)),
        settle(q.heatmap(conn, filters)),
        settle(q.isolateRows(conn, filters)),
        settle(q.options(conn, filters, "countries")),
        settle(q.options(conn, filters, "sources")),
        settle(q.options(conn, filters, "sts")),
      ]);
      if (!cancelled) setData({ headline, timeline, heatmap, isolates, countries, sources, sts });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [conn, filters]);

  return { filters, setFilters, data, years };
}
