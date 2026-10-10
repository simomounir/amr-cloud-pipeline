import type { Filters } from "../data/filters";
import { EMPTY_FILTERS } from "../data/filters";
import type { OptionKey, OptionRow } from "../data/queries";

type ListFilter = OptionKey;

const LABELS: Record<ListFilter, string> = { studies: "Study", countries: "Country", sources: "Isolation source", sts: "Sequence type" };

export function FilterBar({
  filters,
  onChange,
  optionRows,
  years,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  optionRows: Partial<Record<ListFilter, OptionRow[]>>;
  years: { min: number | null; max: number | null };
}) {
  // Keep ticked values listed (with 0) even when other filters leave them no genomes.
  const listed = (key: ListFilter): OptionRow[] => {
    const rows = optionRows[key] ?? [];
    const missing = filters[key].filter((v) => !rows.some((o) => o.value === v));
    return [...rows, ...missing.map((value) => ({ value, isolates: 0 }))];
  };
  const toggle = (key: ListFilter, value: string) => {
    const current = filters[key];
    onChange({ ...filters, [key]: current.includes(value) ? current.filter((v) => v !== value) : [...current, value] });
  };
  const yearInput = (bound: "yearMin" | "yearMax", label: string, placeholder: number) => (
    <label>
      {label}
      <input
        type="number"
        min={years.min ?? undefined}
        max={years.max ?? undefined}
        value={filters[bound] ?? ""}
        placeholder={String(placeholder)}
        onChange={(e) => onChange({ ...filters, [bound]: e.target.value ? Number(e.target.value) : null })}
      />
    </label>
  );
  return (
    <aside className="filters" aria-label="Filters">
      {(Object.keys(LABELS) as ListFilter[]).map((key) => (
        <fieldset key={key}>
          <legend>{LABELS[key]}</legend>
          <div className="options">
            {listed(key).map((o) => (
              <label key={o.value}>
                <input type="checkbox" checked={filters[key].includes(o.value)} onChange={() => toggle(key, o.value)} />
                {key === "sources" ? o.value.replace(/_/g, " ") : o.value} ({o.isolates})
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      {years.min !== null && years.max !== null && (
        <fieldset>
          <legend>Collection year</legend>
          <div className="years">
            {yearInput("yearMin", "From", years.min)}
            {yearInput("yearMax", "To", years.max)}
          </div>
        </fieldset>
      )}
      <label>
        <input
          type="checkbox"
          checked={filters.carbapenemaseOnly}
          onChange={(e) => onChange({ ...filters, carbapenemaseOnly: e.target.checked })}
        />{" "}
        Carbapenemase carriers only
      </label>
      <label>
        <input
          type="checkbox"
          checked={!filters.hideQcWarnings}
          onChange={(e) => onChange({ ...filters, hideQcWarnings: !e.target.checked })}
        />{" "}
        Include genomes with QC warnings
      </label>
      <button onClick={() => onChange({ ...EMPTY_FILTERS, includeIntrinsic: filters.includeIntrinsic })}>Clear filters</button>
    </aside>
  );
}
