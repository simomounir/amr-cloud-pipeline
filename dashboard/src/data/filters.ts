export interface Filters {
  countries: string[];
  sources: string[];
  sts: string[];
  yearMin: number | null;
  yearMax: number | null;
  carbapenemaseOnly: boolean;
  hideQcWarnings: boolean;
}

export type ListFilter = "countries" | "sources" | "sts";

export const EMPTY_FILTERS: Filters = {
  countries: [],
  sources: [],
  sts: [],
  yearMin: null,
  yearMax: null,
  carbapenemaseOnly: false,
  hideQcWarnings: true,
};

const LIST_COLUMNS: Record<ListFilter, string> = {
  countries: "country",
  sources: "source_category",
  sts: "st",
};

/** Filters -> WHERE clause over the `isolates` view. User values only ever become `?` params. */
export function toWhere(filters: Filters, omit?: ListFilter): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  for (const key of Object.keys(LIST_COLUMNS) as ListFilter[]) {
    const values = filters[key];
    if (key === omit || values.length === 0) continue;
    clauses.push(`${LIST_COLUMNS[key]} IN (${values.map(() => "?").join(", ")})`);
    params.push(...values);
  }
  if (filters.yearMin !== null) {
    clauses.push("collection_year >= ?");
    params.push(filters.yearMin);
  }
  if (filters.yearMax !== null) {
    clauses.push("collection_year <= ?");
    params.push(filters.yearMax);
  }
  if (filters.carbapenemaseOnly) clauses.push("has_carbapenemase");
  if (filters.hideQcWarnings) clauses.push("qc_status = 'pass'");
  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}
