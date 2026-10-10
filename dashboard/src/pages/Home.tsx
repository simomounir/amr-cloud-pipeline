import { PipelineDiagram } from "../components/PipelineDiagram";
import { ProjectFacts } from "../components/ProjectFacts";
import { StudyCard } from "../components/StudyCard";
import type { StudyEntry, StudyInfo } from "../data/studies";
import { toHash } from "../state/url";

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
  const latest = loaded.at(-1);
  return (
    <div className="home">
      <header className="home-hero">
        <h1>
          Public <em>Klebsiella pneumoniae</em> genomes, re-analysed in the cloud and checked
        </h1>
        <p className="lede">
          A reproducible pipeline on AWS Batch turns public sequencing reads from ENA into validated tables. Each study
          asks one question of them, and this site queries the results in your browser.
        </p>
        <ProjectFacts infos={loaded} />
        {latest && (
          <a className="cta" href={toHash({ page: "study", study: latest.study })}>
            Read the study: {latest.title}
          </a>
        )}
        <PipelineDiagram />
      </header>
      <h2>Studies</h2>
      <ul className="study-cards">
        {studies.map(({ study }) => (
          <StudyCard key={study} study={study} info={infos[study] ?? null} />
        ))}
        {failed.map((f) => (
          <StudyCard key={f.study} study={f.study} info={null} error={f.error} />
        ))}
      </ul>
      <h2>How it works</h2>
      <ol className="how-steps">
        {STEPS.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </div>
  );
}
