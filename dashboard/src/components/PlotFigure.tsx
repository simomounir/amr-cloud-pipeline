import * as Plot from "@observablehq/plot";
import { useEffect, useRef, useState } from "react";

/** Plot's own default width, used until the container has been measured (and in server rendering). */
const DEFAULT_WIDTH = 640;

/** The width the figure gets: its container's, kept within [minWidth, maxWidth]; below minWidth it scrolls. */
export function figureWidth(container: number, minWidth: number, maxWidth: number): number {
  return Math.round(Math.max(minWidth, Math.min(maxWidth, container)));
}

export function PlotFigure({
  options,
  summary,
  onPick,
  minWidth = 320,
  maxWidth = 1280,
}: {
  /** Plot options, or a function of the width the figure will be drawn at (for layouts that change on phones). */
  options: Plot.PlotOptions | ((width: number) => Plot.PlotOptions);
  summary: string;
  minWidth?: number;
  maxWidth?: number;
  /**
   * Called with the datum under the pointer on click (Plot sets `figure.value` for marks with `tip`).
   * Memoise it.
   */
  onPick?: (datum: unknown) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [container, setContainer] = useState<number | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setContainer(Math.floor(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const width = container === null ? Math.min(DEFAULT_WIDTH, maxWidth) : figureWidth(container, minWidth, maxWidth);
  useEffect(() => {
    const resolved = typeof options === "function" ? options(width) : options;
    const figure = Plot.plot({
      width,
      ...resolved,
      style: {
        background: "transparent",
        color: "var(--ink)",
        fontFamily: "inherit",
        fontSize: "12px",
        ...(typeof resolved.style === "object" ? resolved.style : {}),
      },
    });
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
    let pointerType = "";
    const remember = () => {
      const value = valueOf();
      if (value != null) pointed = value;
      // A mouse that moved onto blank plot area has nothing under it; touch keeps its datum until the click.
      else if (pointerType === "mouse") pointed = null;
    };
    const track = (event: Event) => {
      pointerType = (event as PointerEvent).pointerType;
    };
    const unpinned = (event: Event) => {
      track(event);
      remember();
      if (pointerType === "mouse") event.stopPropagation();
    };
    const leave = (event: Event) => {
      if ((event as PointerEvent).pointerType === "mouse") pointed = null;
    };
    const click = () => {
      if (onPick && pointed != null) onPick(pointed);
      // A tap's datum belongs to that tap only (touch gives no pointerleave before the next one).
      pointed = null;
    };
    figure.addEventListener("input", remember);
    figure.addEventListener("pointermove", track, true);
    figure.addEventListener("pointerdown", unpinned, true);
    figure.addEventListener("pointerleave", leave);
    figure.addEventListener("click", click);
    if (onPick) figure.style.cursor = "pointer";
    // The figure lives in its own child so the measured container keeps its width while charts redraw.
    ref.current?.firstElementChild?.replaceChildren(figure);
    return () => {
      figure.removeEventListener("input", remember);
      figure.removeEventListener("pointermove", track, true);
      figure.removeEventListener("pointerdown", unpinned, true);
      figure.removeEventListener("pointerleave", leave);
      figure.removeEventListener("click", click);
      figure.remove();
    };
  }, [options, onPick, width]);
  return (
    <figure className="plot">
      <div ref={ref} className="plot-frame">
        <div />
      </div>
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  );
}
