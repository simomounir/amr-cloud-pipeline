import { inline } from "../text";

export function RichText({ text }: { text: string }) {
  return (
    <>
      {inline(text).map((s, i) =>
        s.kind === "em" ? (
          <em key={i}>{s.text}</em>
        ) : s.kind === "strong" ? (
          <strong key={i}>{s.text}</strong>
        ) : s.kind === "link" ? (
          <a key={i} href={s.href} rel="noopener">
            {s.text}
          </a>
        ) : (
          s.text
        ),
      )}
    </>
  );
}
