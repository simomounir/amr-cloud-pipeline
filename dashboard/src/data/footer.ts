import type { Manifest } from "./manifest";
import type { AnalysisCounts } from "./queries";
import type { StudyEntry } from "./studies";

export type FooterEntry =
  | { ok: true; study: string; release: string; built: string; schema: string; counts: AnalysisCounts }
  | { ok: false; study: string; error: string };

/** One footer row per listed or failed study; a study that did not load is labelled, never thrown on. */
export function footerEntries(
  studies: StudyEntry[],
  manifests: Record<string, Manifest>,
  counts: Record<string, AnalysisCounts>,
  failed: { study: string; error: string }[],
): FooterEntry[] {
  const rows: FooterEntry[] = studies.map(({ study, release }) => {
    const manifest = manifests[study];
    const c = counts[study];
    if (!manifest || !c) return { ok: false, study, error: "no data loaded" };
    return { ok: true, study, release, built: manifest.created_at.slice(0, 10), schema: String(manifest.schema_version), counts: c };
  });
  const shown = new Set(rows.map((r) => r.study));
  for (const f of failed) if (!shown.has(f.study)) rows.push({ ok: false, study: f.study, error: f.error });
  return rows;
}
