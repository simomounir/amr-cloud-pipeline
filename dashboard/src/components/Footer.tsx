import type { Manifest } from "../data/manifest";
import type { AnalysisCounts } from "../data/queries";

const REPO = "https://github.com/simomounir/amr-cloud-pipeline";

export function Footer({ manifest, tag, counts }: { manifest: Manifest; tag: string; counts: AnalysisCounts }) {
  return (
    <footer>
      <p>Public data; demonstrates a method, not surveillance findings.</p>
      <p>
        Dataset{" "}
        {tag ? <a href={`${REPO}/releases/tag/${encodeURIComponent(tag)}`}>{tag}</a> : "unknown"} · built {manifest.created_at.slice(0, 10)} ·{" "}
        <span data-testid="footer-counts">
          {counts.analysed} isolates analysed{counts.failed > 0 && ` · ${counts.failed} failed analysis`}
        </span>{" "}
        · schema {manifest.schema_version} ·{" "}
        <a href={REPO}>source code</a>
      </p>
    </footer>
  );
}
