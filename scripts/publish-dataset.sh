#!/usr/bin/env bash
# Publish a workflow artifact as GitHub Release dataset-YYYY-MM-DD and pin it for the site.
#
# Usage: scripts/publish-dataset.sh [--dry-run] [--notes FILE] <workflow-run-id> [artifact-name]
#   artifact: a built dataset (manifest.json at the top, e.g. "seed-dataset", the default) or a
#   Cloud run artifact ("cloud-run-<study>-<run-id>"), whose runs/*/results/parquet folders are
#   combined with `amrtools build-dataset`.
#
# The site shows the release named in dashboard/dataset.txt, so the script updates that file and
# the commit you make afterwards deploys it. (Pages identifies deployments by commit: a release
# alone does not redeploy an unchanged commit.)
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
pin="${DATASET_PIN:-$root/dashboard/dataset.txt}"
dry=0 notes=""
while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run) dry=1; shift ;;
        --notes) notes=$2; shift 2 ;;
        *) break ;;
    esac
done
RUN_ID=${1:?usage: publish-dataset.sh [--dry-run] [--notes FILE] <workflow-run-id> [artifact-name]}
ARTIFACT=${2:-seed-dataset}
TAG="dataset-$(date -u +%F)"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

command -v amrtools > /dev/null || { echo "error: amrtools not on PATH (try: PATH=.venv/bin:\$PATH)" >&2; exit 1; }
if gh release view "$TAG" > /dev/null 2>&1; then
    echo "error: release $TAG already exists" >&2
    exit 1
fi
gh run download "$RUN_ID" --name "$ARTIFACT" --dir "$WORK/artifact"
if [ -f "$WORK/artifact/manifest.json" ]; then
    dataset="$WORK/artifact"
else
    runs=()
    while IFS= read -r dir; do runs+=("$dir"); done < <(find "$WORK/artifact" -type d -path '*/results/parquet' | sort)
    [ ${#runs[@]} -gt 0 ] || { echo "error: $ARTIFACT has neither manifest.json nor */results/parquet" >&2; exit 1; }
    dataset="$WORK/dataset"
    amrtools build-dataset "${runs[@]}" --out "$dataset"
fi
amrtools validate "$dataset"
SCHEMA=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['schema_version'])" "$dataset/manifest.json")
default_notes="Results dataset (schema $SCHEMA) from workflow run $RUN_ID. Public data; demonstrates a method, not surveillance findings."

if [ "$dry" = 1 ]; then
    echo "dry run: would publish $TAG ($(ls "$dataset" | tr '\n' ' ')) and pin it in ${pin#"$root"/}"
    exit 0
fi
if [ -n "$notes" ]; then note_args=(--notes-file "$notes"); else note_args=(--notes "$default_notes"); fi
gh release create "$TAG" "$dataset"/*.parquet "$dataset/manifest.json" --latest=false \
    --title "Dataset $(date -u +%F)" "${note_args[@]}"
echo "$TAG" > "$pin"
echo "published $TAG and pinned it in ${pin#"$root"/}."
echo "Next: commit that file and merge it to main; the commit deploys the site with this dataset."
