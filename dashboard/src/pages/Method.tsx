import { REPO } from "../config";
import type { StudyEntry, StudyInfo } from "../data/studies";

const unique = (values: string[]) => [...new Set(values)].join(", ");

export function Method({
  studies = [],
  infos = {},
}: {
  studies?: StudyEntry[];
  infos?: Record<string, StudyInfo | null>;
}) {
  const all = studies.flatMap(({ study }) => (infos[study] ? [infos[study]] : []));
  const amrfinder = unique(all.flatMap((i) => i.versions.amrfinder));
  const amrfinderDb = unique(all.flatMap((i) => i.versions.amrfinder_db));
  return (
    <div className="page-head method">
      <h1>How the pipeline works</h1>
      <p>
        Every number on this site comes from the same open pipeline, run on public <em>Klebsiella pneumoniae</em>{" "}
        genomes.
      </p>
      <h2>Pipeline steps</h2>
      <ol>
        <li>
          <strong>fastp</strong> trims adapters and low-quality bases from the paired Illumina reads.
        </li>
        <li>
          <strong>Shovill</strong> assembles each genome.
        </li>
        <li>
          <strong>AMRFinderPlus</strong> (<code>--plus</code>) finds acquired resistance genes and mutations
          {amrfinder && `; version ${amrfinder}`}
          {amrfinder && amrfinderDb && `, database ${amrfinderDb}`}
          .
        </li>
        <li>
          <strong>Kleborate</strong> assigns sequence type and species and flags assembly quality.
        </li>
        <li>
          <code>amrtools</code> merges the outputs, validates them and writes the Parquet tables.
        </li>
      </ol>
      <h2>Cloud</h2>
      <ul>
        <li>GitHub Actions signs in to AWS with OIDC; no long-lived keys are stored.</li>
        <li>Terraform defines all infrastructure.</li>
        <li>AWS Batch runs on spot instances, capped at 96 vCPU.</li>
        <li>
          Inputs and results live in S3. A release is published from the Cloud run&apos;s workflow artifact with{" "}
          <code>scripts/publish-dataset.sh</code>.
        </li>
        <li>Compute is destroyed after every run, and AWS budgets alert on spend.</li>
      </ul>
      <h2>Validation</h2>
      <ul>
        <li>Unit and end-to-end tests cover the pipeline code and this dashboard.</li>
        <li>Each change is reviewed before it is merged.</li>
        <li>
          Results are compared with published references (sequence type and carbapenemase family); the agreement is
          shown on each study page, with every disagreement listed.
        </li>
      </ul>
      <h2>Read more</h2>
      <ul>
        <li>
          <a href={`${REPO}/blob/main/README.md`}>README.md</a>
        </li>
        <li>
          <a href={`${REPO}/blob/main/infra/README.md`}>infra/README.md</a>
        </li>
        <li>
          <a href={`${REPO}/tree/main/studies`}>studies/</a>
        </li>
      </ul>
    </div>
  );
}
