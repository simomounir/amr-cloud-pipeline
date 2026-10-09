import type { Filters } from "../data/filters";

export type ChipKey = "clones" | "periods" | "families" | "combos" | "countries";

const LABELS: Record<ChipKey, string> = {
  clones: "clone",
  periods: "period",
  families: "carries",
  combos: "combo",
  countries: "country",
};

export function FilterChips({
  filters,
  onChange,
  keys = ["clones", "periods", "families", "combos", "countries"],
}: {
  filters: Filters;
  onChange: (next: Filters) => void;
  keys?: ChipKey[];
}) {
  const chips = keys.flatMap((key) => filters[key].map((value) => ({ key, value })));
  if (chips.length === 0) return null;
  const clearAll = () => onChange({ ...filters, ...Object.fromEntries(keys.map((k) => [k, []])) });
  return (
    <div className="chips" role="group" aria-label="Active selection">
      {chips.map(({ key, value }) => (
        <button
          key={`${key}:${value}`}
          className="chip"
          aria-label={`Remove ${LABELS[key]} ${value}`}
          onClick={() => onChange({ ...filters, [key]: filters[key].filter((v) => v !== value) })}
        >
          {LABELS[key]}: {value} ×
        </button>
      ))}
      <button className="chip chip-clear" onClick={clearAll}>
        Clear all
      </button>
    </div>
  );
}
