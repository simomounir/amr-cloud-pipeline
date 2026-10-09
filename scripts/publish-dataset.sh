#!/usr/bin/env bash
# Publish a workflow artifact as a GitHub Release and pin it for the site.
#
# Usage: scripts/publish-dataset.sh [--dry-run] [--notes FILE] [--study NAME] <workflow-run-id> [artifact-name]
#   artifact: a built dataset (manifest.json at the top, e.g. "seed-dataset", the default) or a
#   Cloud run artifact ("cloud-run-<study>-<run-id>"), whose runs/*/results/parquet folders are
#   combined with `amrtools build-dataset`.
#   --study NAME: release dataset-NAME-YYYY-MM-DD (otherwise dataset-YYYY-MM-DD) that also carries
#   cohort.parquet and study.json from `amrtools study-bundle` (studies/NAME/); needs a Cloud run
#   artifact with exactly one run folder.
#
# The site shows the releases listed in dashboard/studies.json, so the script updates that file and
# the commit you make afterwards deploys it. (Pages identifies deployments by commit: a release
# alone does not redeploy an unchanged commit.)
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
pin="${STUDIES_PIN:-$root/dashboard/studies.json}"
studies_dir="${STUDIES_DIR:-$root/studies}"
dry=0 notes="" study=""
while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run) dry=1; shift ;;
        --notes) notes=$2; shift 2 ;;
        --study) study=$2; shift 2 ;;
        *) break ;;
    esac
done
RUN_ID=${1:?usage: publish-dataset.sh [--dry-run] [--notes FILE] [--study NAME] <workflow-run-id> [artifact-name]}
ARTIFACT=${2:-seed-dataset}
if [ -n "$study" ]; then
    [ -f "$studies_dir/$study/story.md" ] || { echo "error: $studies_dir/$study/story.md is required to publish a study" >&2; exit 1; }
    TAG="dataset-$study-$(date -u +%F)"
else
    TAG="dataset-$(date -u +%F)"
fi
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

command -v amrtools > /dev/null || { echo "error: amrtools not on PATH (try: PATH=.venv/bin:\$PATH)" >&2; exit 1; }
if gh release view "$TAG" > /dev/null 2>&1; then
    echo "error: release $TAG already exists" >&2
    exit 1
fi
runs=()
gh run download "$RUN_ID" --name "$ARTIFACT" --dir "$WORK/artifact"
if [ -f "$WORK/artifact/manifest.json" ]; then
    dataset="$WORK/artifact"
else
    while IFS= read -r dir; do runs+=("$dir"); done < <(find "$WORK/artifact" -type d -path '*/results/parquet' | sort)
    [ ${#runs[@]} -gt 0 ] || { echo "error: $ARTIFACT has neither manifest.json nor */results/parquet" >&2; exit 1; }
    dataset="$WORK/dataset"
    amrtools build-dataset "${runs[@]}" --out "$dataset"
fi
amrtools validate "$dataset"
if [ -n "$study" ]; then
    [ "${#runs[@]}" -eq 1 ] || { echo "error: one Cloud run per study release (found ${#runs[@]})" >&2; exit 1; }
    amrtools study-bundle --study-dir "$studies_dir/$study" --dataset "$dataset" \
        --run-dir "$(dirname "$(dirname "${runs[0]}")")" --out "$dataset"
fi
SCHEMA=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['schema_version'])" "$dataset/manifest.json")
default_notes="Results dataset (schema $SCHEMA) from workflow run $RUN_ID. Public data; demonstrates a method, not surveillance findings."

if [ "$dry" = 1 ]; then
    echo "dry run: would publish $TAG ($(ls "$dataset" | tr '\n' ' ')) and pin it in ${pin#"$root"/}"
    exit 0
fi
if [ -n "$notes" ]; then note_args=(--notes-file "$notes"); else note_args=(--notes "$default_notes"); fi
assets=("$dataset"/*.parquet "$dataset/manifest.json")
if [ -f "$dataset/study.json" ]; then assets+=("$dataset/study.json"); fi
gh release create "$TAG" "${assets[@]}" --latest=false \
    --title "Dataset ${study:+$study }$(date -u +%F)" "${note_args[@]}"
python3 - "$pin" "${study:-site}" "$TAG" <<'PY'
import json, sys
path, study, tag = sys.argv[1:]
entries = json.load(open(path))
for entry in entries:
    if entry["study"] == study:
        entry["release"] = tag
        break
else:
    entries.append({"study": study, "release": tag})
open(path, "w").write(json.dumps(entries, indent=2) + "\n")
PY
echo "published $TAG and pinned it in ${pin#"$root"/}"
echo "Next: commit that file and merge it to main; the commit deploys the site with this dataset."
