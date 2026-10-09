import type { StudyInfo } from "../data/studies";

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Headline numbers across every study that has a study.json. */
export function StatTiles({ infos, studyCount }: { infos: StudyInfo[]; studyCount: number }) {
  const genomes = infos.reduce((n, i) => n + i.run.analysed, 0);
  const cost = median(infos.flatMap((i) => (i.run.cost_per_genome_usd === null ? [] : [i.run.cost_per_genome_usd])));
  const agree = infos.reduce((n, i) => n + (i.agreement?.carbapenemase_family.agree ?? 0), 0);
  const total = infos.reduce((n, i) => n + (i.agreement?.carbapenemase_family.total ?? 0), 0);
  const tiles = [
    { id: "genomes", label: "Genomes analysed", value: genomes.toLocaleString("en-US") },
    { id: "cost", label: "Cost per genome (median)", value: cost === null ? "n/a" : `$${cost.toFixed(3)}` },
    {
      id: "agreement",
      label: "Carbapenemase agreement with references",
      value: total === 0 ? "n/a" : `${Math.round((agree / total) * 100)}%`,
    },
    { id: "studies", label: "Studies", value: String(studyCount) },
  ];
  return (
    <dl className="stat-tiles">
      {tiles.map((t) => (
        <div key={t.id} className="stat-tile">
          <dt>{t.label}</dt>
          <dd data-testid={`tile-${t.id}`}>{t.value}</dd>
        </div>
      ))}
    </dl>
  );
}
