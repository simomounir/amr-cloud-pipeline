import type { Headline as HeadlineData } from "../data/queries";

const pct = (share: number) => `${Math.round(share * 100)}%`;

export function Headline({ data }: { data: HeadlineData }) {
  const years =
    data.year_min === null
      ? "—"
      : data.year_min === data.year_max
        ? `${data.year_min}`
        : `${data.year_min}–${data.year_max}`;
  const stats = [
    { label: "Genomes", value: String(data.isolates), id: "headline-isolates" },
    { label: "Carry a carbapenemase", value: pct(data.carbapenemase_share) },
    { label: "Carry CTX-M (ESBL)", value: pct(data.ctxm_share) },
    { label: "Countries", value: String(data.countries) },
    { label: "Collection years", value: years, note: `year known for ${pct(data.year_known_share)}` },
  ];
  return (
    <dl className="headline">
      {stats.map((s) => (
        <div key={s.label}>
          <dt>{s.label}</dt>
          <dd data-testid={s.id}>{s.value}</dd>
          {s.note && <dd className="note">{s.note}</dd>}
        </div>
      ))}
    </dl>
  );
}
