import type { Manifest } from "../data/manifest";
import type { AnalysisCounts } from "../data/queries";
import type { StudyEntry } from "../data/studies";

const REPO = "https://github.com/simomounir/amr-cloud-pipeline";

export function Footer({
  studies,
  manifests,
  counts,
}: {
  studies: StudyEntry[];
  manifests: Record<string, Manifest>;
  counts: Record<string, AnalysisCounts>;
}) {
  return (
    <footer>
      <p>Public data; demonstrates a method, not surveillance findings.</p>
      <ul className="footer-studies">
        {studies.map(({ study, release }) => {
          const c = counts[study];
          return (
            <li key={study}>
              <a href={`${REPO}/releases/tag/${encodeURIComponent(release)}`}>{release}</a> · built{" "}
              {manifests[study].created_at.slice(0, 10)} ·{" "}
              <span data-testid={`footer-counts-${study}`}>
                {study}: {c.analysed} analysed{c.failed > 0 && ` · ${c.failed} failed analysis`}
              </span>{" "}
              · schema {manifests[study].schema_version}
            </li>
          );
        })}
      </ul>
      <p>
        <a href={REPO}>source code</a>
      </p>
    </footer>
  );
}
