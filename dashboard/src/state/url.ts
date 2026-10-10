import { EMPTY_FILTERS, type Filters } from "../data/filters";
import { isStudySlug } from "../data/tables";

export type Route = { page: "home" } | { page: "study"; study: string } | { page: "explore" } | { page: "method" };

const LISTS = { study: "studies", country: "countries", source: "sources", st: "sts", clone: "clones", period: "periods", family: "families", combo: "combos" } as const;
type ListKey = (typeof LISTS)[keyof typeof LISTS];

/** Decodes one URL component; returns null for malformed percent-encoding. */
function safeDecode(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

function parseRoute(path: string): Route {
  const parts = path.replace(/^\/+/, "").split("/");
  if (parts[0] === "study" && isStudySlug(parts[1])) return { page: "study", study: parts[1] };
  if (parts[0] === "explore") return { page: "explore" };
  if (parts[0] === "method") return { page: "method" };
  return { page: "home" };
}

export function parseHash(hash: string): { route: Route; filters: Partial<Filters> } {
  const [path, query = ""] = hash.replace(/^#/, "").split("?");
  const filters: Partial<Filters> = {};
  for (const pair of query.split("&")) {
    const [key, raw = ""] = pair.split("=");
    if (Object.hasOwn(LISTS, key)) {
      const values = raw
        .split(",")
        .filter(Boolean)
        .map(safeDecode)
        .filter((v): v is string => v !== null);
      if (values.length) filters[LISTS[key as keyof typeof LISTS] as ListKey] = values;
    } else if ((key === "from" || key === "to") && /^\d{4}$/.test(raw) && Number(raw) >= 1900 && Number(raw) <= 2100) {
      filters[key === "from" ? "yearMin" : "yearMax"] = Number(raw);
    } else if (key === "carb" && raw === "1") filters.carbapenemaseOnly = true;
    else if (key === "intrinsic" && raw === "1") filters.includeIntrinsic = true;
    else if (key === "qc" && (raw === "all" || raw === "pass")) filters.hideQcWarnings = raw === "pass";
  }
  // An impossible range (from after to) is dropped rather than shown as an empty result.
  const { yearMin, yearMax } = filters;
  if (yearMin != null && yearMax != null && yearMin > yearMax) {
    delete filters.yearMin;
    delete filters.yearMax;
  }
  const route = parseRoute(path);
  return { route, filters };
}

export function toHash(requested: Route, filters: Partial<Filters> = {}): string {
  // A study that is not a slug cannot be parsed back, so it is written as the home page.
  const route: Route = requested.page === "study" && !isStudySlug(requested.study) ? { page: "home" } : requested;
  const f = { ...EMPTY_FILTERS, ...filters };
  const path = route.page === "home" ? "/" : route.page === "study" ? `/study/${route.study}` : `/${route.page}`;
  const parts: string[] = [];
  for (const [key, field] of Object.entries(LISTS)) {
    if (f[field].length) parts.push(`${key}=${f[field].map(encodeURIComponent).join(",")}`);
  }
  if (f.yearMin !== null) parts.push(`from=${f.yearMin}`);
  if (f.yearMax !== null) parts.push(`to=${f.yearMax}`);
  if (f.carbapenemaseOnly) parts.push("carb=1");
  if (f.includeIntrinsic) parts.push("intrinsic=1");
  // Genomes with QC warnings are included by default on every page; qc=pass hides them.
  if (f.hideQcWarnings) parts.push("qc=pass");
  return `#${path}${parts.length ? `?${parts.join("&")}` : ""}`;
}
