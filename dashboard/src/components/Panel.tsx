import type { ReactNode } from "react";

export function Panel({
  title,
  error,
  empty,
  onClear,
  children,
}: {
  title: string;
  error?: string;
  empty?: boolean;
  onClear?: () => void;
  children: ReactNode;
}) {
  const id = `${title.toLowerCase().replace(/\W+/g, "-")}-h`;
  return (
    <section className="panel" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {error ? (
        <p className="panel-error" role="alert">
          Could not load this panel: {error}
        </p>
      ) : empty ? (
        <p className="panel-empty">
          No genomes match these filters. {onClear && <button onClick={onClear}>Clear filters</button>}
        </p>
      ) : (
        children
      )}
    </section>
  );
}
