#!/usr/bin/env bash
# Run the pipeline on AWS Batch for one study:
#   apply infra/compute → ensure the AMRFinderPlus DB is in S3 → Nextflow (head on this machine,
#   tasks on Batch spot, credentials = the amr-pipeline-runner role, refreshed automatically) →
#   copy results back and
#   validate → cost report → destroy compute. Compute is destroyed on exit even if a step fails.
#
# Usage: AWS_PROFILE=admin infra/scripts/run-on-batch.sh --study <name> --input <samplesheet.csv> [--profile test]
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
infra="$root/infra"
export AWS_PROFILE="${AWS_PROFILE:-admin}"
TF="${TF:-terraform}"
NXF="${NXF:-nextflow}"
log() { printf '\n== [%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

study="" input="" extra_profile=""
while [ $# -gt 0 ]; do
    case "$1" in
        --study) study=$2; shift 2 ;;
        --input) input=$2; shift 2 ;;
        --profile) extra_profile=",$2"; shift 2 ;;
        *) echo "unknown argument: $1" >&2; exit 2 ;;
    esac
done
[ -n "$study" ] && [ -n "$input" ] || { echo "usage: $0 --study <name> --input <csv> [--profile <p>]" >&2; exit 2; }
[[ "$study" =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "study must be lowercase letters, digits and '-'" >&2; exit 2; }
input=$(cd "$(dirname "$input")" && pwd)/$(basename "$input")
samples=$(( $(grep -c . "$input") - 1 ))
run_id=$(date -u +%Y%m%dT%H%M%SZ)
local_dir="$root/runs/$study/$run_id"
mkdir -p "$local_dir"

account=$(aws sts get-caller-identity --query Account --output text)
for r in platform compute; do
    printf 'bucket = "amr-tfstate-%s"\n' "$account" > "$infra/$r/backend.hcl"
    "$TF" -chdir="$infra/$r" init -input=false -backend-config=backend.hcl > /dev/null
done
bucket=$("$TF" -chdir="$infra/platform" output -raw bucket)
runner=$("$TF" -chdir="$infra/platform" output -raw runner_role_arn)
region=$("$TF" -chdir="$infra/platform" output -raw region)
start=$(date -u +%Y-%m-%dT%H:%M:%SZ)
compute_applied=0

cleanup() {
    local status=$? rc=0
    trap - EXIT
    [ -n "${nf_config:-}" ] && rm -f "$nf_config"
    if [ "$compute_applied" = 1 ]; then
        log "cost report (before destroy, while instance records are visible)"
        python3 "$infra/scripts/cost_report.py" --region "$region" --since "$start" \
            --samples "$samples" --json "$local_dir/cost.json" || echo "cost report failed (see Cost Explorer tomorrow)"
    fi
    log "destroy compute"
    "$TF" -chdir="$infra/compute" destroy -auto-approve -input=false || rc=$?
    log "leftover check"
    left=$(
        aws ec2 describe-instances --region "$region" \
            --filters Name=tag:Project,Values=amr-cloud-pipeline Name=instance-state-name,Values=pending,running,stopping,stopped \
            --query 'length(Reservations)' --output text 2> /dev/null || echo ERROR
        aws batch describe-compute-environments --region "$region" --compute-environments amr-spot \
            --query 'length(computeEnvironments)' --output text 2> /dev/null || echo ERROR
        aws ec2 describe-vpcs --region "$region" --filters Name=tag:Project,Values=amr-cloud-pipeline \
            --query 'length(Vpcs)' --output text 2> /dev/null || echo ERROR
    )
    if echo "$left" | grep -qvx 0; then
        echo "WARNING: compute may still exist (instances/compute envs/vpcs: $(echo $left)). Check the console."
        rc=1
    else
        echo "compute: nothing left"
    fi
    log "run $study/$run_id finished; local copy in ${local_dir#"$root"/}"
    [ "$status" -ne 0 ] && exit "$status"
    exit "$rc"
}
trap cleanup EXIT

log "compute: apply"
"$TF" -chdir="$infra/compute" apply -auto-approve -input=false
compute_applied=1

log "AMRFinderPlus database in s3://$bucket/refs/"
db=$(aws s3 ls "s3://$bucket/refs/" 2> /dev/null | awk '{print $4}' | grep -E '^amrfinderdb-.*\.tar\.gz$' | sort | tail -1 || true)
if [ -z "$db" ]; then
    log "no database in S3 yet: building one (docker, amd64) and uploading"
    tmp=$(mktemp -d)
    docker run --rm --platform linux/amd64 -u "$(id -u):$(id -g)" -v "$tmp:/work" -w /work \
        quay.io/biocontainers/ncbi-amrfinderplus:4.2.7--hf69ffd2_0 \
        sh -c 'amrfinder_update -d amrfinderdb && v=$(readlink amrfinderdb/latest) && tar czf "amrfinderdb-$v.tar.gz" -C "amrfinderdb/$v" . && rm -rf amrfinderdb'
    db=$(basename "$(ls "$tmp"/amrfinderdb-*.tar.gz)")
    aws s3 cp "$tmp/$db" "s3://$bucket/refs/$db"
    rm -rf "$tmp"
fi
echo "using refs/$db"

log "nextflow on Batch as $runner (study=$study run=$run_id samples=$samples)"
# A role assumed from an `aws login` session is "role chaining", capped at 1 hour. Instead of
# fixed keys, give Nextflow a profile whose credential_process asks the AWS CLI for fresh
# runner-role credentials whenever they near expiry. Written to a temporary config file so
# ~/.aws/config is never modified.
nf_config=$(mktemp)
cat "${AWS_CONFIG_FILE:-$HOME/.aws/config}" > "$nf_config"
cat >> "$nf_config" <<CFG

[profile amr-runner]
role_arn = $runner
source_profile = $AWS_PROFILE
role_session_name = nf-$study
region = $region

[profile amr-runner-process]
credential_process = aws configure export-credentials --profile amr-runner --format process
region = $region
CFG
(
    cd "$local_dir"
    AWS_CONFIG_FILE="$nf_config" AWS_PROFILE=amr-runner-process AWS_REGION="$region" \
        caffeinate -i "$NXF" run "$root" -profile "awsbatch$extra_profile" \
        --input "$input" --study "$study" --run_id "$run_id" \
        --amrfinder_db "s3://$bucket/refs/$db" \
        --outdir "s3://$bucket/results/$study/$run_id" \
        -work-dir "s3://$bucket/work/$study/$run_id" \
        -with-trace trace.tsv -with-report report.html -ansi-log false
)
rm -f "$nf_config"

log "copy results and validate"
aws s3 cp "s3://$bucket/results/$study/$run_id/" "$local_dir/results/" --recursive --quiet
"$root/.venv/bin/amrtools" validate "$local_dir/results/parquet"
log "pipeline run succeeded"
