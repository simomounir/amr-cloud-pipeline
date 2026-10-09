import { PipelineDiagram } from "../components/PipelineDiagram";
import { StatTiles } from "../components/StatTiles";
import { StudyCard } from "../components/StudyCard";
import type { StudyEntry, StudyInfo } from "../data/studies";

const STEPS = [
  "Pick a question and a cohort of public genomes; the study is a folder in the repository.",
  "One click in GitHub Actions starts a run; the workflow signs in to AWS with OIDC, no stored keys.",
  "AWS Batch runs the analysis on spot instances, about two hours and five dollars for 150 genomes, then the compute is destroyed.",
  "The results are validated and published as Parquet tables in a GitHub release.",
  "This site loads the tables into DuckDB in your browser; there is no server.",
];

export function Home({
  studies,
  infos,
  failed = [],
}: {
  studies: StudyEntry[];
  infos: Record<string, StudyInfo | null>;
  failed?: { study: string; error: string }[];
}) {
  const loaded = studies.flatMap(({ study }) => (infos[study] ? [infos[study]] : []));
  return (
    <div className="home">
      <header className="page-head">
        <h1>Klebsiella AMR</h1>
        <p className="subtitle">A project of the AMR Cloud Pipeline</p>
        <p className="intro">
          Public bacterial genomes are re-analysed in the cloud with one reproducible pipeline, and the results are
          explored here without leaving your browser. <em>Klebsiella pneumoniae</em> for now — a WHO critical-priority
          pathogen.
        </p>
      </header>
      <StatTiles infos={loaded} studyCount={studies.length + failed.length} />
      <h2>How it works</h2>
      <PipelineDiagram />
      <ol className="how-steps">
        {STEPS.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <h2>Studies</h2>
      <ul className="study-cards">
        {studies.map(({ study }) => (
          <StudyCard key={study} study={study} info={infos[study] ?? null} />
        ))}
        {failed.map((f) => (
          <StudyCard key={f.study} study={f.study} info={null} error={f.error} />
        ))}
      </ul>
    </div>
  );
}
