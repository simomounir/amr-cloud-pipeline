export interface Filters {
  studies: string[];
  countries: string[];
  sources: string[];
  sts: string[];
  clones: string[];
  periods: string[];
  families: string[];
  combos: string[];
  yearMin: number | null;
  yearMax: number | null;
  carbapenemaseOnly: boolean;
  hideQcWarnings: boolean;
  /** Display option of the elements chart (not a row filter): include intrinsic genes. */
  includeIntrinsic: boolean;
}

export type ListFilter = "studies" | "countries" | "sources" | "sts" | "clones" | "periods" | "combos";

export const EMPTY_FILTERS: Filters = {
  studies: [],
  countries: [],
  sources: [],
  sts: [],
  clones: [],
  periods: [],
  families: [],
  combos: [],
  yearMin: null,
  yearMax: null,
  carbapenemaseOnly: false,
  hideQcWarnings: true,
  includeIntrinsic: false,
};

const LIST_COLUMNS: Record<ListFilter, string> = {
  studies: "study",
  countries: "country",
  sources: "source_category",
  sts: "st",
  clones: "clone",
  periods: "period",
  combos: "family_combo",
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
  if (filters.families.length) {
    clauses.push(`len(list_intersect(family_list, [${filters.families.map(() => "?").join(", ")}])) > 0`);
    params.push(...filters.families);
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
