import { costPerGenome, formatCostPerGenome } from "../data/format";
import type { StudyInfo } from "../data/studies";
import { toHash } from "../state/url";
import { Predates } from "./Predates";

/** One study on the home page. `error` marks a study that could not be loaded; `info` null means no study.json. */
export function StudyCard({ study, info, error }: { study: string; info: StudyInfo | null; error?: string }) {
  if (error !== undefined) {
    return (
      <li className="study-card">
        <h3>{study}</h3>
        <p className="study-note" role="alert">
          This study could not be loaded: {error}
        </p>
      </li>
    );
  }
  return (
    <li className="study-card">
      <h3>
        <a href={toHash({ page: "study", study })}>{info?.title ?? study}</a>
      </h3>
      {info ? (
        <>
          <p>{info.question}</p>
          {info.findings[0] && (
            <p className="key-finding">
              <strong>Key finding:</strong> {info.findings[0].title}
            </p>
          )}
          <p className="study-note">
            {info.run.analysed} genomes analysed
            {costPerGenome(info.run) !== null && ` · ${formatCostPerGenome(info.run)} per analysed genome`}
          </p>
        </>
      ) : (
        <Predates />
      )}
    </li>
  );
}
