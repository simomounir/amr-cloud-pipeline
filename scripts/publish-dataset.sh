#!/usr/bin/env bash
# Publish a dataset artifact from a workflow run as GitHub Release dataset-YYYY-MM-DD.
# Usage: scripts/publish-dataset.sh <workflow-run-id> [artifact-name]
set -euo pipefail

RUN_ID=${1:?usage: publish-dataset.sh <workflow-run-id> [artifact-name]}
ARTIFACT=${2:-seed-dataset}
TAG="dataset-$(date -u +%F)"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

if gh release view "$TAG" >/dev/null 2>&1; then
    echo "error: release $TAG already exists" >&2
    exit 1
fi
gh run download "$RUN_ID" --name "$ARTIFACT" --dir "$WORK/dataset"
amrtools validate "$WORK/dataset"
SCHEMA=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['schema_version'])" "$WORK/dataset/manifest.json")
gh release create "$TAG" "$WORK"/dataset/*.parquet "$WORK/dataset/manifest.json" \
    --title "Dataset $(date -u +%F)" \
    --notes "Results dataset (schema $SCHEMA) from workflow run $RUN_ID. Public data; demonstrates a method, not surveillance findings."
echo "published $TAG"
