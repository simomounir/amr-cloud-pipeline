export interface Manifest {
  schema_version: string;
  created_at: string;
  runs: { run_id: string; run_started_at: string; samples: number }[];
  tables: Record<string, { file: string; rows: number; sha256: string }>;
}

export class DashboardError extends Error {}

export function checkSchema(manifest: Manifest): void {
  const major = Number(manifest.schema_version.split(".")[0]);
  if (major !== 1) {
    throw new DashboardError(`Dataset schema ${manifest.schema_version} is not supported by this dashboard (needs 1.x)`);
  }
}

export async function loadManifest(baseUrl: string, fetchFn: typeof fetch = fetch): Promise<Manifest> {
  const url = new URL("manifest.json", baseUrl).href;
  let response: Response;
  try {
    response = await fetchFn(url);
  } catch {
    throw new DashboardError(`Dataset unavailable: ${url} (network error)`);
  }
  if (!response.ok) throw new DashboardError(`Dataset unavailable: ${url} (HTTP ${response.status})`);
  const manifest = (await response.json()) as Manifest;
  checkSchema(manifest);
  return manifest;
}
