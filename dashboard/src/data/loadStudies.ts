import { loadManifest, type Manifest } from "./manifest";
import { loadStudyInfo, type StudyEntry, type StudyInfo } from "./studies";
import { BASE_TABLES, isParquetAt } from "./tables";

export interface LoadedStudy {
  study: string;
  manifest: Manifest;
  info: StudyInfo | null;
  hasCohort: boolean;
}
export interface FailedStudy {
  study: string;
  error: string;
}
export interface StudyHooks {
  /** Makes one table's Parquet file readable by the database. */
  register: (study: string, table: string, url: string) => Promise<void>;
  /** Throws when the registered table cannot be read. */
  probe: (study: string, table: string) => Promise<void>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Loads every listed study on its own: a study whose manifest, study.json or tables are broken is
 * returned in `failed` with its error, and the others still load.
 */
export async function loadAvailableStudies(
  dataUrl: string,
  listed: StudyEntry[],
  hooks: StudyHooks,
  fetchFn: typeof fetch = fetch,
): Promise<{ loaded: LoadedStudy[]; failed: FailedStudy[] }> {
  const loaded: LoadedStudy[] = [];
  const failed: FailedStudy[] = [];
  for (const { study } of listed) {
    try {
      const manifest = await loadManifest(new URL(`${study}/`, dataUrl).href, fetchFn);
      let info: StudyInfo | null;
      try {
        info = await loadStudyInfo(dataUrl, study, fetchFn);
      } catch (e) {
        throw new Error(`${study}/study.json is not valid: ${message(e)}`, { cause: e });
      }
      let hasCohort = false;
      for (const table of BASE_TABLES) {
        const url = new URL(`${study}/${table}.parquet`, dataUrl).href;
        if (table === "cohort") {
          if (!(await isParquetAt(url, fetchFn))) continue;
          hasCohort = true;
        }
        await hooks.register(study, table, url);
        await hooks.probe(study, table);
      }
      loaded.push({ study, manifest, info, hasCohort });
    } catch (e) {
      failed.push({ study, error: message(e) });
    }
  }
  return { loaded, failed };
}
