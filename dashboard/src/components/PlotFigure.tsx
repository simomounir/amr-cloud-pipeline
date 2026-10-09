import * as Plot from "@observablehq/plot";
import { useEffect, useRef } from "react";

export function PlotFigure({
  options,
  summary,
  onPick,
}: {
  options: Plot.PlotOptions;
  summary: string;
  /** Called with the datum under the pointer on click (Plot sets `figure.value` for marks with `tip`). Memoise it. */
  onPick?: (datum: unknown) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const figure = Plot.plot({ ...options, style: { background: "transparent", color: "var(--ink)", ...(typeof options.style === "object" ? options.style : {}) } });
    // Plot's own `:where(.plot)` rule sets --plot-background: white on each svg and its style option
    // ignores custom properties, so tooltips and markers only follow the theme if it is set here.
    for (const svg of figure.tagName === "svg" ? [figure] : figure.querySelectorAll("svg")) {
      svg.style.setProperty("--plot-background", "var(--surface)");
    }
    const click = () => {
      const value = (figure as unknown as { value?: unknown }).value;
      if (onPick && value != null) onPick(value);
    };
    figure.addEventListener("click", click);
    if (onPick) figure.style.cursor = "pointer";
    ref.current?.replaceChildren(figure);
    return () => {
      figure.removeEventListener("click", click);
      figure.remove();
    };
  }, [options, onPick]);
  return (
    <figure>
      <div ref={ref} />
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  );
}
