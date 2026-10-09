import * as Plot from "@observablehq/plot";
import { useEffect, useRef } from "react";

export function PlotFigure({ options, summary }: { options: Plot.PlotOptions; summary: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const figure = Plot.plot({ ...options, style: { background: "transparent", color: "var(--ink)", ...(typeof options.style === "object" ? options.style : {}) } });
    // Plot's own `:where(.plot)` rule sets --plot-background: white on each svg and its style option
    // ignores custom properties, so tooltips and markers only follow the theme if it is set here.
    for (const svg of figure.tagName === "svg" ? [figure] : figure.querySelectorAll("svg")) {
      svg.style.setProperty("--plot-background", "var(--surface)");
    }
    ref.current?.replaceChildren(figure);
    return () => figure.remove();
  }, [options]);
  return (
    <figure>
      <div ref={ref} />
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  );
}
