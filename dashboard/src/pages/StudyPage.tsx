import type { StudyEntry, StudyInfo } from "../data/studies";
import { toHash } from "../state/url";

export function Predates() {
  return (
    <p className="study-note">
      This study&apos;s release predates study pages; republish it with <code>publish-dataset.sh --study</code>.
    </p>
  );
}

export function StudyPage({
  study,
  studies,
  infos,
}: {
  study: string;
  studies: StudyEntry[];
  infos: Record<string, StudyInfo | null>;
}) {
  if (!studies.some((s) => s.study === study)) {
    return (
      <div className="page-head">
        <h1>No such study</h1>
        <p>
          There is no study called <code>{study}</code>. <a href={toHash({ page: "home" })}>Back to the home page</a>.
        </p>
      </div>
    );
  }
  const info = infos[study];
  return (
    <div className="page-head">
      <h1>{info?.title ?? study}</h1>
      {info ? <p>{info.question}</p> : <Predates />}
    </div>
  );
}
