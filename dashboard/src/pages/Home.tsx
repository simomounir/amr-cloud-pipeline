import type { StudyEntry, StudyInfo } from "../data/studies";
import { toHash } from "../state/url";
import { Predates } from "./StudyPage";

export function Home({ studies, infos }: { studies: StudyEntry[]; infos: Record<string, StudyInfo | null> }) {
  return (
    <div className="page-head">
      <h1>AMR Explorer</h1>
      <p>
        Antimicrobial resistance in public <em>Klebsiella pneumoniae</em> genomes, queried in your browser.
      </p>
      <ul className="study-cards">
        {studies.map(({ study }) => {
          const info = infos[study];
          return (
            <li key={study}>
              <a href={toHash({ page: "study", study })}>{info?.title ?? study}</a>
              {info ? <p className="study-note">{info.question}</p> : <Predates />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
