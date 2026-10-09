import * as Plot from "@observablehq/plot";
import { useEffect, useRef } from "react";

export function PlotFigure({ options, summary }: { options: Plot.PlotOptions; summary: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const figure = Plot.plot({ ...options, style: { background: "transparent", color: "var(--ink)", ...(typeof options.style === "object" ? options.style : {}) } });
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
