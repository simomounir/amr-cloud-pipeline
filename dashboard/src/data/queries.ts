import type { Connection } from "./connection";
import { type Filters, type ListFilter, toWhere } from "./filters";
import headlineSql from "./sql/headline.sql?raw";
import topElementsSql from "./sql/top_elements.sql?raw";
import isolatesSql from "./sql/isolates.sql?raw";
import optionsSql from "./sql/options.sql?raw";
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
const OPTION_COLUMNS: Record<ListFilter, string> = {
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

export function options(conn: Connection, filters: Filters, key: ListFilter): Promise<OptionRow[]> {
  return run<OptionRow>(conn, optionsSql.replace("{{column}}", OPTION_COLUMNS[key]), filters, key);
}

export async function yearBounds(conn: Connection): Promise<{ min: number | null; max: number | null }> {
  const [row] = await conn.query<{ min: number | null; max: number | null }>(yearsSql);
  return row;
}
