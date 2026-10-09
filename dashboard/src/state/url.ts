import { EMPTY_FILTERS, type Filters } from "../data/filters";

export type Route = { page: "home" } | { page: "study"; study: string } | { page: "explore" } | { page: "method" };

const LISTS = { study: "studies", country: "countries", source: "sources", st: "sts", clone: "clones", period: "periods", family: "families", combo: "combos" } as const;
type ListKey = (typeof LISTS)[keyof typeof LISTS];

function parseRoute(path: string): Route {
  const parts = path.replace(/^\/+/, "").split("/");
  if (parts[0] === "study" && /^[a-z0-9][a-z0-9-]*$/.test(parts[1] ?? "")) return { page: "study", study: parts[1] };
  if (parts[0] === "explore") return { page: "explore" };
  if (parts[0] === "method") return { page: "method" };
  return { page: "home" };
}

export function parseHash(hash: string): { route: Route; filters: Partial<Filters> } {
  const [path, query = ""] = hash.replace(/^#/, "").split("?");
  const filters: Partial<Filters> = {};
  for (const pair of query.split("&")) {
    const [key, raw = ""] = pair.split("=");
    if (key in LISTS) {
      const values = raw.split(",").filter(Boolean).map(decodeURIComponent);
      if (values.length) filters[LISTS[key as keyof typeof LISTS] as ListKey] = values;
    } else if ((key === "from" || key === "to") && /^\d{4}$/.test(raw)) {
      filters[key === "from" ? "yearMin" : "yearMax"] = Number(raw);
    } else if (key === "carb" && raw === "1") filters.carbapenemaseOnly = true;
    else if (key === "qc" && raw === "all") filters.hideQcWarnings = false;
  }
  return { route: parseRoute(path), filters };
}

export function toHash(route: Route, filters: Partial<Filters> = {}): string {
  const f = { ...EMPTY_FILTERS, ...filters };
  const path = route.page === "home" ? "/" : route.page === "study" ? `/study/${route.study}` : `/${route.page}`;
  const parts: string[] = [];
  for (const [key, field] of Object.entries(LISTS)) {
    if (f[field].length) parts.push(`${key}=${f[field].map(encodeURIComponent).join(",")}`);
  }
  if (f.yearMin !== null) parts.push(`from=${f.yearMin}`);
  if (f.yearMax !== null) parts.push(`to=${f.yearMax}`);
  if (f.carbapenemaseOnly) parts.push("carb=1");
  if (!f.hideQcWarnings) parts.push("qc=all");
  return `#${path}${parts.length ? `?${parts.join("&")}` : ""}`;
}
