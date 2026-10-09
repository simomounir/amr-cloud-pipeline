export type Span = { kind: "text" | "em" | "strong"; text: string } | { kind: "link"; text: string; href: string };

const TOKEN = /\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

/** Splits text with **strong**, *emphasis* and [label](http(s) url) into spans. */
export function inline(text: string): Span[] {
  const spans: Span[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > last) spans.push({ kind: "text", text: text.slice(last, m.index) });
    if (m[1] !== undefined) spans.push({ kind: "strong", text: m[1] });
    else if (m[2] !== undefined) spans.push({ kind: "em", text: m[2] });
    else spans.push({ kind: "link", text: m[3], href: m[4] });
    last = m.index + m[0].length;
  }
  if (last < text.length) spans.push({ kind: "text", text: text.slice(last) });
  return spans;
}
