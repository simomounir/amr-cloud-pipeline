import type { Manifest } from "../data/manifest";

export function Footer({ manifest, tag }: { manifest: Manifest; tag: string }) {
  return (
    <footer>
      <p>Public data; demonstrates a method, not surveillance findings.</p>
      <p>
        Dataset {tag || "unknown"} · built {manifest.created_at.slice(0, 10)} · {manifest.tables.samples?.rows ?? "?"}{" "}
        isolates · schema {manifest.schema_version} ·{" "}
        <a href="https://github.com/simomounir/amr-cloud-pipeline">source code</a>
      </p>
    </footer>
  );
}
