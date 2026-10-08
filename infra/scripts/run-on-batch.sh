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
[[ "$study" =~ ^[a-z0-9][a-z0-9-]{0,39}$ ]] || { echo "study: lowercase letters, digits and '-', at most 40 characters" >&2; exit 2; }
[ -f "$input" ] || { echo "input not found: $input" >&2; exit 2; }
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

# One run at a time: all runs share the compute root, so a second run's destroy would remove the
# first run's queue mid-flight.
existing=$(aws batch describe-compute-environments --region "$region" --compute-environments amr-spot \
    --query 'length(computeEnvironments)' --output text)
if [ "$existing" != "0" ]; then
    echo "compute already exists (another run in progress, or a previous destroy failed)." >&2
    echo "Check, then: terraform -chdir=infra/compute destroy" >&2
    exit 1
fi

stop_nextflow() {
    # Ask Nextflow to shut down (it cancels its Batch jobs) and wait up to 3 minutes.
    pkill -TERM -f -- "--run_id $run_id" 2> /dev/null || return 0
    for _ in $(seq 90); do
        pgrep -f -- "--run_id $run_id" > /dev/null || return 0
        sleep 2
    done
    pkill -KILL -f -- "--run_id $run_id" 2> /dev/null || true
}

cleanup() {
    local status=$? rc=0
    trap - EXIT
    trap '' INT TERM HUP # never interrupt destroy halfway
    stop_nextflow
    [ -n "${nf_config:-}" ] && rm -f "$nf_config"
    rm -rf "$local_dir/db-build"
    log "destroy compute"
    "$TF" -chdir="$infra/compute" destroy -auto-approve -input=false || rc=$?
    if [ "$compute_applied" = 1 ]; then
        # After destroy every instance has a termination time, so each is priced for exactly
        # how long it ran (terminated instances stay visible for about an hour).
        log "cost report"
        "$root/.venv/bin/python" "$infra/scripts/cost_report.py" --region "$region" --since "$start" \
            --samples "$samples" --json "$local_dir/cost.json" || echo "cost report failed (see Cost Explorer tomorrow)"
    fi
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
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

log "compute: apply"
"$TF" -chdir="$infra/compute" apply -auto-approve -input=false
compute_applied=1

log "AMRFinderPlus database in s3://$bucket/refs/"
db=$(aws s3 ls "s3://$bucket/refs/" 2> /dev/null | awk '{print $4}' | grep -E '^amrfinderdb-.*\.tar\.gz$' | sort -V | tail -1 || true)
if [ -z "$db" ]; then
    log "no database in S3 yet: building one (docker, amd64) and uploading"
    tmp="$local_dir/db-build"
    mkdir -p "$tmp"
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
# Batch jobs need a role for S3 access (containers cannot use the host's credentials).
# The ARN contains the account ID, so it is generated here rather than committed.
job_role=$("$TF" -chdir="$infra/compute" output -raw job_role_arn)
printf "aws.batch.jobRole = '%s'\n" "$job_role" > "$local_dir/batch-role.config"
(
    cd "$local_dir"
    AWS_CONFIG_FILE="$nf_config" AWS_PROFILE=amr-runner-process AWS_REGION="$region" \
        caffeinate -i "$NXF" run "$root" -profile "awsbatch$extra_profile" -c batch-role.config \
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
