export const BASE_TABLES = ["samples", "amr_genes", "run_summary", "cohort"] as const;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/** True for a study name safe to put in URLs and SQL (lowercase letters, digits, hyphens). */
export const isStudySlug = (name: unknown): name is string => typeof name === "string" && SLUG.test(name);

const EMPTY_COHORT =
  "CREATE OR REPLACE VIEW cohort AS SELECT NULL::VARCHAR AS study, NULL::VARCHAR AS sample, NULL::VARCHAR AS clone, " +
  "NULL::VARCHAR AS period, NULL::SMALLINT AS year, NULL::VARCHAR AS country, NULL::VARCHAR AS ref_st, " +
  "NULL::VARCHAR AS ref_carbapenemases WHERE FALSE";

/**
 * One view per table over every study's Parquet file, with a `study` column. Studies without a
 * cohort file are left out of the `cohort` view (an empty one is made when none has it).
 */
export function baseViewsSql(
  studies: string[],
  fileFor: (study: string, table: string) => string,
  hasCohort: (study: string) => boolean = () => true,
): string[] {
  for (const study of studies) if (!isStudySlug(study)) throw new Error(`Invalid study name: ${study}`);
  return BASE_TABLES.map((table) => {
    const included = table === "cohort" ? studies.filter(hasCohort) : studies;
    if (included.length === 0) return EMPTY_COHORT;
    const parts = included.map((s) => `SELECT '${s}' AS study, * FROM read_parquet('${fileFor(s, table)}')`);
    return `CREATE OR REPLACE VIEW ${table} AS ${parts.join(" UNION ALL BY NAME ")}`;
  });
}

/** True when `url` serves a Parquet file (first bytes "PAR1"); a 404 or an HTML page at 200 is not. */
export async function isParquetAt(url: string, fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    // no-store: a ranged request answered from the HTTP cache can come back 206 with an empty body.
    const response = await fetchFn(url, { headers: { Range: "bytes=0-3" }, cache: "no-store" });
    if (!response.ok) return false;
    const head = new Uint8Array(await response.arrayBuffer()).slice(0, 4);
    return new TextDecoder().decode(head) === "PAR1";
  } catch {
    return false;
  }
}
