import * as Plot from "@observablehq/plot";
import { useCallback, useMemo } from "react";
import { feature } from "topojson-client";
import world from "world-atlas/countries-110m.json";
import { isoNumeric } from "../data/countries";
import type { CountryRow } from "../data/queries";
import { PlotFigure } from "./PlotFigure";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const land = feature(world as any, (world as any).objects.countries) as unknown as GeoJSON.FeatureCollection;

export function CountryMap({
  rows,
  selected = [],
  onPick,
}: {
  rows: CountryRow[];
  /** Countries currently picked: drawn with an outline, the others dimmed. */
  selected?: string[];
  onPick: (country: string) => void;
}) {
  const { options, missing, placedCount } = useMemo(() => {
    const byId = new Map(land.features.map((f) => [String(f.id), f]));
    const placed = rows.flatMap((r) => {
      const f = byId.get(isoNumeric(r.country) ?? "");
      return f ? [{ ...r, feature: f }] : [];
    });
    const missing = rows.filter((r) => !placed.some((p) => p.country === r.country));
    return {
      missing,
      placedCount: placed.length,
      options: {
        // No fixed height: Plot derives it from the projection's aspect, so the map fills its width.
        projection: "equal-earth",
        style: { background: "transparent", color: "var(--ink)" },
        r: { range: [3, 18] },
        marks: [
          Plot.geo(land, { fill: "var(--chip)", stroke: "var(--line)", strokeWidth: 0.5 }),
          Plot.dot(
            placed,
            Plot.centroid({
              geometry: (d: (typeof placed)[number]) => d.feature,
              r: "genomes",
              fill: "var(--accent)",
              fillOpacity: (d: (typeof placed)[number]) => (selected.length && !selected.includes(d.country) ? 0.25 : 0.7),
              stroke: (d: (typeof placed)[number]) => (selected.includes(d.country) ? "var(--ink)" : "var(--surface)"),
              strokeWidth: (d: (typeof placed)[number]) => (selected.includes(d.country) ? 3 : 2),
              tip: true,
              ariaLabel: (d: (typeof placed)[number]) => d.country,
              title: (d: (typeof placed)[number]) => `${d.country}: ${d.genomes} genomes\nclones: ${d.clones ?? "–"}\ncarbapenemases: ${d.families}`,
            }),
          ),
        ],
      } as Plot.PlotOptions,
    };
  }, [rows, selected]);
  const onPickRow = useCallback((d: unknown) => onPick((d as CountryRow).country), [onPick]);
  return (
    <>
      <PlotFigure options={options} maxWidth={960} summary={`${placedCount} countries on the map`} onPick={onPickRow} />
      {missing.length > 0 && (
        <p className="note">No map shape for: {missing.map((m) => `${m.country} (${m.genomes})`).join(", ")}.</p>
      )}
    </>
  );
}
