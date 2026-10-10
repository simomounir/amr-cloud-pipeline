import { costPerGenome, formatDollars } from "../data/format";
import type { StudyInfo } from "../data/studies";

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** The project's proof in one sentence, across every study that has a study.json. */
export function ProjectFacts({ infos }: { infos: StudyInfo[] }) {
  const genomes = infos.reduce((n, i) => n + i.run.analysed, 0);
  const cost = median(infos.flatMap((i) => costPerGenome(i.run) ?? []));
  const agree = infos.reduce((n, i) => n + (i.agreement?.carbapenemase_family.agree ?? 0), 0);
  const total = infos.reduce((n, i) => n + (i.agreement?.carbapenemase_family.total ?? 0), 0);
  return (
    <p className="facts">
      <span>
        <strong data-testid="fact-genomes">{genomes.toLocaleString("en-US")}</strong> genomes analysed
      </span>
      <span>
        <strong data-testid="fact-cost">{formatDollars(cost)}</strong> per genome (median)
      </span>
      <span>
        <strong data-testid="fact-agreement">{total === 0 ? "n/a" : `${Math.round((agree / total) * 100)}%`}</strong>{" "}
        agree with the reference on carbapenemase family
      </span>
    </p>
  );
}
