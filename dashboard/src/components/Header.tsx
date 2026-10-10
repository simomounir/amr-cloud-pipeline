import type { StudyEntry } from "../data/studies";
import type { Route } from "../state/url";
import { toHash } from "../state/url";
import type { Theme } from "../theme";

/** A short nav label from the study's slug ("carbapenemase-clones" -> "Carbapenemase clones"); titles are too long. */
export function studyLabel(study: string): string {
  const words = study.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function Header({
  studies,
  route,
  theme,
  onToggleTheme,
}: {
  studies: StudyEntry[];
  route: Route;
  theme: Theme;
  onToggleTheme: () => void;
}) {
  const link = (target: Route, label: string) => {
    const current =
      route.page === target.page && (route.page !== "study" || (target.page === "study" && route.study === target.study));
    return (
      <a href={toHash(target)} aria-current={current ? "page" : undefined}>
        {label}
      </a>
    );
  };
  return (
    <header className="site-header">
      <a className="brand" href={toHash({ page: "home" })}>
        Klebsiella AMR
      </a>
      <nav aria-label="Main">
        {link({ page: "home" }, "Home")}
        {studies.map((s) => (
          <span key={s.study}>{link({ page: "study", study: s.study }, studyLabel(s.study))}</span>
        ))}
        {link({ page: "explore" }, "Explore")}
        {link({ page: "method" }, "Method")}
      </nav>
      <button
        type="button"
        className="theme-toggle"
        onClick={onToggleTheme}
        aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      >
        {theme === "dark" ? "Light" : "Dark"}
      </button>
    </header>
  );
}
