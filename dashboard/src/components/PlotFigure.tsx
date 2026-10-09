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
    // Plot pins the tooltip on pointerdown (and clears figure.value on the next one), after which pointermove
    // is ignored, so the pinned datum is not the one under the pointer. Remember the datum from `input` events
    // and stop a mouse pointerdown before Plot sees it: the tooltip then always follows the pointer and a click
    // picks it. Plot ignores non-mouse pointerdown itself, and a touch pointer "leaves" on release, before the
    // click, so touch and pen keep Plot's handling and only a mouse leaving clears the remembered datum.
    const valueOf = () => (figure as unknown as { value?: unknown }).value;
    let pointed: unknown = null;
    const remember = () => {
      const value = valueOf();
      if (value != null) pointed = value;
    };
    const unpinned = (event: Event) => {
      remember();
      if ((event as PointerEvent).pointerType === "mouse") event.stopPropagation();
    };
    const leave = (event: Event) => {
      if ((event as PointerEvent).pointerType === "mouse") pointed = null;
    };
    const click = () => {
      if (onPick && pointed != null) onPick(pointed);
    };
    figure.addEventListener("input", remember);
    figure.addEventListener("pointerdown", unpinned, true);
    figure.addEventListener("pointerleave", leave);
    figure.addEventListener("click", click);
    if (onPick) figure.style.cursor = "pointer";
    ref.current?.replaceChildren(figure);
    return () => {
      figure.removeEventListener("input", remember);
      figure.removeEventListener("pointerdown", unpinned, true);
      figure.removeEventListener("pointerleave", leave);
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
