import { AUTHOR_URL, REPO } from "../config";
import { footerEntries } from "../data/footer";
import type { Manifest } from "../data/manifest";
import type { AnalysisCounts } from "../data/queries";
import type { StudyEntry } from "../data/studies";

export function Footer({
  studies,
  manifests,
  counts,
  failed,
}: {
  studies: StudyEntry[];
  manifests: Record<string, Manifest>;
  counts: Record<string, AnalysisCounts>;
  failed: { study: string; error: string }[];
}) {
  return (
    <footer>
      <p>Public data; demonstrates a method, not surveillance findings.</p>
      <ul className="footer-studies">
        {footerEntries(studies, manifests, counts, failed).map((e) =>
          e.ok ? (
            <li key={e.study}>
              <a href={`${REPO}/releases/tag/${encodeURIComponent(e.release)}`}>{e.release}</a> · built {e.built} ·{" "}
              <span data-testid={`footer-counts-${e.study}`}>
                {e.study}: {e.counts.analysed} analysed{e.counts.failed > 0 && ` · ${e.counts.failed} failed`}
              </span>{" "}
              · schema {e.schema}
            </li>
          ) : (
            <li key={e.study} role="status">
              {e.study}: could not load — {e.error}
            </li>
          ),
        )}
      </ul>
      <p>
        Built by <a href={AUTHOR_URL}>simomounir</a> · <a href={REPO}>source code</a>
      </p>
    </footer>
  );
}
