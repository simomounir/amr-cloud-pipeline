import type { Connection } from "./connection";
import { type Filters, type ListFilter, toWhere } from "./filters";
import countriesSql from "./sql/countries.sql?raw";
import headlineSql from "./sql/headline.sql?raw";
import topElementsSql from "./sql/top_elements.sql?raw";
import heatmapSql from "./sql/heatmap.sql?raw";
import isolatesSql from "./sql/isolates.sql?raw";
import optionsSql from "./sql/options.sql?raw";
import periodMixSql from "./sql/period_mix.sql?raw";
import timelineSql from "./sql/timeline.sql?raw";
import yearsSql from "./sql/years.sql?raw";

export interface Headline {
  isolates: number;
  carbapenemase_share: number;
  ctxm_share: number;
  countries: number;
  year_min: number | null;
  year_max: number | null;
  year_known_share: number;
}
export interface TimelineRow {
  year: string;
  family: string;
  isolates: number;
}
export interface ElementRow {
  gene_symbol: string;
  drug_class: string;
  carriers: number;
  share: number;
}
export interface IsolateRow {
  sample: string;
  run_accession: string | null;
  country: string | null;
  collection_year: number | null;
  source_category: string;
  st: string | null;
  carbapenemase_genes: string | null;
  ctxm_genes: string | null;
  qc_status: string;
}
export interface OptionRow {
  value: string;
  isolates: number;
}

// Option queries interpolate one of these fixed column names, never user input.
export type OptionKey = "studies" | "countries" | "sources" | "sts";
const OPTION_COLUMNS: Record<OptionKey, string> = {
  studies: "study",
  countries: "country",
  sources: "source_category",
  sts: "st",
};

function run<T>(conn: Connection, template: string, filters: Filters, omit?: ListFilter) {
  const where = toWhere(filters, omit);
  return conn.query<T & Record<string, unknown>>(template.replace("{{where}}", where.sql), where.params);
}

export async function headline(conn: Connection, filters: Filters): Promise<Headline> {
  const [row] = await run<Headline>(conn, headlineSql, filters);
  return row;
}

export function timeline(conn: Connection, filters: Filters): Promise<TimelineRow[]> {
  return run<TimelineRow>(conn, timelineSql, filters);
}

export function topElements(conn: Connection, filters: Filters, includeIntrinsic = false): Promise<ElementRow[]> {
  const template = topElementsSql.replace("{{intrinsic}}", includeIntrinsic ? "" : "AND NOT e.is_intrinsic");
  return run<ElementRow>(conn, template, filters);
}

export function isolateRows(conn: Connection, filters: Filters): Promise<IsolateRow[]> {
  return run<IsolateRow>(conn, isolatesSql, filters);
}

export function options(conn: Connection, filters: Filters, key: OptionKey): Promise<OptionRow[]> {
  return run<OptionRow>(conn, optionsSql.replace("{{column}}", OPTION_COLUMNS[key]), filters, key);
}

export interface HeatCell {
  clone: string;
  period: string;
  family: string;
  genomes: number;
  carriers: number;
  share: number;
}
export interface MixRow {
  clone: string;
  period: string;
  combo: string;
  genomes: number;
  share: number;
}
export interface CountryRow {
  country: string;
  genomes: number;
  clones: string | null;
  families: string;
}

export function familyHeatmap(conn: Connection, filters: Filters, byPeriod: boolean): Promise<HeatCell[]> {
  return run<HeatCell>(conn, heatmapSql.replace("{{period}}", byPeriod ? "period" : "'all'"), filters);
}

export function periodMix(conn: Connection, filters: Filters): Promise<MixRow[]> {
  return run<MixRow>(conn, periodMixSql, filters);
}

export function countryCounts(conn: Connection, filters: Filters): Promise<CountryRow[]> {
  return run<CountryRow>(conn, countriesSql, filters);
}

export interface AnalysisCounts {
  analysed: number;
  failed: number;
}

// A sample whose analysis failed has metadata but no run_summary row (schema 1.2.0 also marks it
// in samples.analysis_status; counting this way works for older datasets too).
export async function analysisCounts(conn: Connection, study?: string): Promise<AnalysisCounts> {
  const where = study === undefined ? "" : "WHERE study = ?";
  const [row] = await conn.query<{ analysed: number; failed: number }>(
    `SELECT (SELECT count(*) FROM run_summary ${where})::INTEGER AS analysed,
            ((SELECT count(*) FROM samples ${where}) - (SELECT count(*) FROM run_summary ${where}))::INTEGER AS failed`,
    study === undefined ? [] : [study, study, study],
  );
  return { analysed: row.analysed, failed: row.failed };
}

export async function yearBounds(conn: Connection): Promise<{ min: number | null; max: number | null }> {
  const [row] = await conn.query<{ min: number | null; max: number | null }>(yearsSql);
  return row;
}
