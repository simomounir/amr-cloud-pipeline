export type FigureId = "heatmap" | "periods" | "map" | "agreement";
export interface StudyEntry {
  study: string;
  release: string;
}
export interface Finding {
  id: string;
  figure: FigureId | null;
  title: string;
  text: string;
}
export interface Disagreement {
  sample: string;
  field: "st" | "carbapenemase_family";
  ours: string | null;
  reference: string | null;
}
export interface Agreement {
  st: { agree: number; total: number };
  carbapenemase_family: { agree: number; total: number };
  family_matrix: { ours: string; reference: string; genomes: number }[];
  disagreements: Disagreement[];
  not_in_reference?: string[];
}
export interface RunFacts {
  run_id: string;
  selected: number;
  analysed: number;
  failed: string[];
  cost_usd: number | null;
  cost_per_genome_usd: number | null;
  instance_hours: number | null;
  wall_time_minutes: number | null;
}
export interface StudyInfo {
  study: string;
  title: string;
  question: string;
  focus: string;
  background: string[];
  findings: Finding[];
  caveats?: string[];
  /** Hand-written interpretation ("What this means" in story.md); absent in older releases. */
  meaning?: string[];
  reference: { name: string } | null;
  run: RunFacts;
  agreement: Agreement | null;
  versions: { amrfinder: string[]; amrfinder_db: string[] };
}

export async function loadStudies(dataUrl: string, fetchFn: typeof fetch = fetch): Promise<StudyEntry[]> {
  const response = await fetchFn(new URL("studies.json", dataUrl).href);
  if (!response.ok) throw new Error(`No studies.json (HTTP ${response.status})`);
  return (await response.json()) as StudyEntry[];
}

export async function loadStudyInfo(
  dataUrl: string,
  study: string,
  fetchFn: typeof fetch = fetch,
): Promise<StudyInfo | null> {
  const response = await fetchFn(new URL(`${study}/study.json`, dataUrl).href);
  return response.ok ? ((await response.json()) as StudyInfo) : null;
}
