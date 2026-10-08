#!/usr/bin/env bash
# Live smoke test for infra/main: apply → run one tiny Batch job → check its S3 output →
# wait for Batch to scale back to 0 → destroy → check no project resources are left.
# Destroy runs on exit even if a step fails. Expected cost: < $0.05.
# Usage: AWS_PROFILE=admin infra/scripts/smoke-test.sh
set -euo pipefail

cd "$(dirname "$0")/../main"
export AWS_PROFILE="${AWS_PROFILE:-admin}"
TF="${TF:-terraform}"

log() { printf '\n== [%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

account=$(aws sts get-caller-identity --query Account --output text)
printf 'bucket = "amr-tfstate-%s"\n' "$account" > backend.hcl
"$TF" init -input=false -backend-config=backend.hcl > /dev/null

cleanup() {
    status=$?
    log "cleanup: empty smoke/ and destroy"
    bucket=$("$TF" output -raw bucket 2> /dev/null || true)
    if [ -n "$bucket" ]; then
        aws s3 rm "s3://$bucket/smoke/" --recursive --quiet || true
    fi
    "$TF" destroy -auto-approve -input=false
    log "leftover check (asks each service directly; the tagging index lags behind deletions)"
    region=$(aws configure get region || echo eu-west-1)
    leftovers=$(
        printf 'instances=%s ' "$(aws ec2 describe-instances --region "$region" \
            --filters Name=tag:Project,Values=amr-cloud-pipeline Name=instance-state-name,Values=pending,running,stopping,stopped \
            --query 'length(Reservations)' --output text)"
        printf 'volumes=%s ' "$(aws ec2 describe-volumes --region "$region" \
            --filters Name=tag:Project,Values=amr-cloud-pipeline --query 'length(Volumes)' --output text)"
        printf 'vpcs=%s ' "$(aws ec2 describe-vpcs --region "$region" \
            --filters Name=tag:Project,Values=amr-cloud-pipeline --query 'length(Vpcs)' --output text)"
        printf 'compute_envs=%s ' "$(aws batch describe-compute-environments --region "$region" \
            --compute-environments amr-spot --query 'length(computeEnvironments)' --output text)"
        printf 'roles=%s ' "$(aws iam list-roles --query 'length(Roles[?starts_with(RoleName, `amr-`)])' --output text)"
        aws s3api head-bucket --bucket "amr-pipeline-$account" > /dev/null 2>&1 && printf 'bucket=1' || printf 'bucket=0'
    )
    echo "$leftovers"
    if echo "$leftovers" | grep -qE '=[1-9]'; then
        echo "WARNING: project resources still exist (bucket=1 is expected only if results/ was kept)"
    else
        echo "nothing left (inactive job definitions remain by AWS design; they cost nothing)"
    fi
    log "total time: $(( ($(date +%s) - start) / 60 )) min; exit status $status"
}

start=$(date +%s)
trap cleanup EXIT

log "terraform apply"
"$TF" apply -auto-approve -input=false
bucket=$("$TF" output -raw bucket)
queue=$("$TF" output -raw job_queue)
jobdef=$("$TF" output -raw smoke_job_definition)

log "submit smoke job"
job=$(aws batch submit-job --job-name amr-smoke --job-queue "$queue" --job-definition "$jobdef" \
    --tags "Study=smoke,Run=$(date -u +%Y%m%dT%H%M)" --query jobId --output text)
echo "job $job"

previous=""
deadline=$(( $(date +%s) + 1200 ))
while :; do
    state=$(aws batch describe-jobs --jobs "$job" --query 'jobs[0].status' --output text)
    [ "$state" != "$previous" ] && echo "  $(date +%H:%M:%S) $state" && previous=$state
    case "$state" in
        SUCCEEDED) break ;;
        FAILED)
            aws batch describe-jobs --jobs "$job" --query 'jobs[0].[statusReason,attempts[-1].container.reason]' --output text
            exit 1 ;;
    esac
    [ "$(date +%s)" -gt "$deadline" ] && { echo "timed out waiting for the job"; exit 1; }
    sleep 15
done

log "check S3 output"
aws s3 cp "s3://$bucket/smoke/$job.txt" -

log "wait for the compute environment to scale back to 0 vCPUs"
deadline=$(( $(date +%s) + 1200 ))
while :; do
    vcpus=$(aws batch describe-compute-environments --compute-environments amr-spot \
        --query 'computeEnvironments[0].computeResources.desiredvCpus' --output text)
    echo "  $(date +%H:%M:%S) desired vCPUs: $vcpus"
    [ "$vcpus" = "0" ] && break
    [ "$(date +%s)" -gt "$deadline" ] && { echo "did not scale to 0 within 20 min (destroy still runs)"; break; }
    sleep 30
done
log "smoke test passed"
