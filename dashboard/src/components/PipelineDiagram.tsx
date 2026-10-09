const STEPS = [
  { title: "Study", lines: ["question + cohort"] },
  { title: "GitHub Actions", lines: ["one click, OIDC"] },
  { title: "AWS Batch spot", lines: ["~2 h, ~$5", "per 150 genomes"] },
  { title: "Release", lines: ["validated Parquet"] },
  { title: "This site", lines: ["DuckDB in", "your browser"] },
];
const W = 150;
const H = 74;
const GAP = 34;

function Box({ x, y, step }: { x: number; y: number; step: (typeof STEPS)[number] }) {
  return (
    <g>
      <rect x={x} y={y} width={W} height={H} rx={8} fill="var(--surface)" stroke="var(--line)" strokeWidth={1.5} />
      <text x={x + W / 2} y={y + 28} textAnchor="middle" fontSize={14} fontWeight={700} fill="var(--ink)">
        {step.title}
      </text>
      {step.lines.map((l, i) => (
        <text key={l} x={x + W / 2} y={y + 47 + i * 15} textAnchor="middle" fontSize={12} fill="var(--ink)">
          {l}
        </text>
      ))}
    </g>
  );
}

function Arrow({ x1, y1, x2, y2, m }: { x1: number; y1: number; x2: number; y2: number; m: string }) {
  return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--accent)" strokeWidth={2} markerEnd={`url(#${m})`} />;
}

function Defs({ id }: { id: string }) {
  return (
    <defs>
      <marker id={id} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto">
        <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" />
      </marker>
    </defs>
  );
}

/** Study to site, drawn twice (horizontal and vertical) so CSS can pick one without scaling text. */
export function PipelineDiagram() {
  const hw = STEPS.length * W + (STEPS.length - 1) * GAP;
  const vh = STEPS.length * H + (STEPS.length - 1) * GAP;
  const label = `Pipeline: ${STEPS.map((s) => s.title).join(", then ")}.`;
  return (
    <figure className="pipeline">
      <svg className="pipeline-h" viewBox={`0 0 ${hw} ${H}`} role="img" aria-label={label}>
        <Defs id="pipe-arrow-h" />
        {STEPS.map((s, i) => (
          <g key={s.title}>
            <Box x={i * (W + GAP)} y={0} step={s} />
            {i > 0 && <Arrow x1={i * (W + GAP) - GAP + 4} y1={H / 2} x2={i * (W + GAP) - 3} y2={H / 2} m="pipe-arrow-h" />}
          </g>
        ))}
      </svg>
      <svg className="pipeline-v" viewBox={`0 0 ${W} ${vh}`} role="img" aria-label={label}>
        <Defs id="pipe-arrow-v" />
        {STEPS.map((s, i) => (
          <g key={s.title}>
            <Box x={0} y={i * (H + GAP)} step={s} />
            {i > 0 && <Arrow x1={W / 2} y1={i * (H + GAP) - GAP + 4} x2={W / 2} y2={i * (H + GAP) - 3} m="pipe-arrow-v" />}
          </g>
        ))}
      </svg>
    </figure>
  );
}
