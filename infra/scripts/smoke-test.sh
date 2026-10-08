#!/usr/bin/env bash
# Live smoke test. Ensures the long-lived platform root (bucket, runner role) is applied,
# then applies the compute root → submits one tiny Batch job AS THE RUNNER ROLE → checks its
# S3 output → waits for Batch to scale to 0 → destroys compute → checks nothing is left.
# Compute is destroyed on exit even if a step fails; platform stays (it is meant to).
# Expected cost: < $0.05.   Usage: AWS_PROFILE=admin infra/scripts/smoke-test.sh
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
export AWS_PROFILE="${AWS_PROFILE:-admin}"
TF="${TF:-terraform}"
log() { printf '\n== [%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

account=$(aws sts get-caller-identity --query Account --output text)
for r in platform compute; do
    printf 'bucket = "amr-tfstate-%s"\n' "$account" > "$root/$r/backend.hcl"
    "$TF" -chdir="$root/$r" init -input=false -backend-config=backend.hcl > /dev/null
done

start=$(date +%s)

log "platform: apply (long-lived; no-op when already up to date)"
"$TF" -chdir="$root/platform" apply -auto-approve -input=false
bucket=$("$TF" -chdir="$root/platform" output -raw bucket)
runner=$("$TF" -chdir="$root/platform" output -raw runner_role_arn)
region=$("$TF" -chdir="$root/platform" output -raw region)

count() { # count <label> <aws command...>: prints label=N, or label=ERROR if the call fails
    local label=$1; shift
    local n
    if n=$("$@" 2> /dev/null); then printf '%s=%s ' "$label" "$n"; else printf '%s=ERROR ' "$label"; fi
}

cleanup() {
    local status=$? rc=0
    trap - EXIT
    log "cleanup: empty smoke/ and destroy compute"
    aws s3 rm "s3://$bucket/smoke/" --recursive --quiet || rc=$?
    "$TF" -chdir="$root/compute" destroy -auto-approve -input=false || rc=$?
    log "leftover check (asks each service directly)"
    left=$(
        count instances aws ec2 describe-instances --region "$region" \
            --filters Name=tag:Project,Values=amr-cloud-pipeline Name=instance-state-name,Values=pending,running,stopping,stopped \
            --query 'length(Reservations)' --output text
        count volumes aws ec2 describe-volumes --region "$region" \
            --filters Name=tag:Project,Values=amr-cloud-pipeline --query 'length(Volumes)' --output text
        count vpcs aws ec2 describe-vpcs --region "$region" \
            --filters Name=tag:Project,Values=amr-cloud-pipeline --query 'length(Vpcs)' --output text
        count compute_envs aws batch describe-compute-environments --region "$region" \
            --compute-environments amr-spot --query 'length(computeEnvironments)' --output text
        count job_queues aws batch describe-job-queues --region "$region" \
            --job-queues amr-queue --query 'length(jobQueues)' --output text
        count launch_templates aws ec2 describe-launch-templates --region "$region" \
            --filters Name=tag:Project,Values=amr-cloud-pipeline --query 'length(LaunchTemplates)' --output text
        count log_groups aws logs describe-log-groups --region "$region" \
            --log-group-name-prefix /amr/batch --query 'length(logGroups)' --output text
        count compute_roles aws iam list-roles \
            --query 'length(Roles[?RoleName==`amr-batch-instance` || RoleName==`amr-batch-job`])' --output text
    )
    echo "$left"
    if echo "$left" | grep -qE '=([1-9]|ERROR)'; then
        echo "WARNING: compute resources may still exist (or a check failed). Look before walking away."
        rc=1
    else
        echo "compute: nothing left. Platform (bucket $bucket, runner role) stays by design."
    fi
    log "total time: $(( ($(date +%s) - start) / 60 )) min"
    [ "$status" -ne 0 ] && exit "$status"
    exit "$rc"
}
trap cleanup EXIT

log "compute: apply"
"$TF" -chdir="$root/compute" apply -auto-approve -input=false
queue=$("$TF" -chdir="$root/compute" output -raw job_queue)
jobdef=$("$TF" -chdir="$root/compute" output -raw smoke_job_definition)

log "submit smoke job as $runner"
creds=$(aws sts assume-role --role-arn "$runner" --role-session-name amr-smoke \
    --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' --output text)
read -r rk rs rt <<< "$creds"
job=$(AWS_ACCESS_KEY_ID=$rk AWS_SECRET_ACCESS_KEY=$rs AWS_SESSION_TOKEN=$rt AWS_PROFILE='' \
    aws batch submit-job --region "$region" --job-name amr-smoke --job-queue "$queue" \
    --job-definition "$jobdef" --tags "Study=smoke,Run=$(date -u +%Y%m%dT%H%M)" \
    --query jobId --output text)
unset creds rk rs rt
echo "job $job"

previous=""
deadline=$(( $(date +%s) + 1200 ))
while :; do
    state=$(aws batch describe-jobs --region "$region" --jobs "$job" --query 'jobs[0].status' --output text)
    [ "$state" != "$previous" ] && echo "  $(date +%H:%M:%S) $state" && previous=$state
    case "$state" in
        SUCCEEDED) break ;;
        FAILED)
            aws batch describe-jobs --region "$region" --jobs "$job" \
                --query 'jobs[0].[statusReason,attempts[-1].container.reason]' --output text
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
    vcpus=$(aws batch describe-compute-environments --region "$region" --compute-environments amr-spot \
        --query 'computeEnvironments[0].computeResources.desiredvCpus' --output text)
    echo "  $(date +%H:%M:%S) desired vCPUs: $vcpus"
    [ "$vcpus" = "0" ] && break
    [ "$(date +%s)" -gt "$deadline" ] && { echo "did not scale to 0 within 20 min (destroy still runs)"; break; }
    sleep 30
done
log "smoke test passed"
