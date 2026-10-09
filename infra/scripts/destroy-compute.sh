#!/usr/bin/env bash
# Destroy infra/compute, first releasing a Terraform state lock older than --unlock-after minutes.
# A run killed during apply or destroy (cancel, timeout) leaves its lock behind, and every later
# destroy would then fail on it. Used by the Cloud run cleanup step (--unlock-after 0: the
# cloud-run concurrency group guarantees no other cloud run holds it) and by the Janitor.
#
# Usage: infra/scripts/destroy-compute.sh [--unlock-after MINUTES]   (credentials: the deployer)
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
TF="${TF:-terraform}"
unlock_after=""
while [ $# -gt 0 ]; do
    case "$1" in
        --unlock-after) unlock_after=$2; shift 2 ;;
        *) echo "unknown argument: $1" >&2; exit 2 ;;
    esac
done

account=$(aws sts get-caller-identity --query Account --output text)
state_bucket="amr-tfstate-$account"
"$TF" -chdir="$root/infra/compute" init -input=false -backend-config="bucket=$state_bucket" > /dev/null

if [ -n "$unlock_after" ] &&
    lock=$(aws s3 cp "s3://$state_bucket/compute/terraform.tfstate.tflock" - 2> /dev/null); then
    read -r id age < <(printf '%s' "$lock" | python3 -c '
import json, sys
from datetime import datetime, timezone
info = json.load(sys.stdin)
age = (datetime.now(timezone.utc) - datetime.fromisoformat(info["Created"])).total_seconds() / 60
print(info["ID"], int(age))')
    if [ "$age" -ge "$unlock_after" ]; then
        echo "releasing a ${age}-minute-old state lock left by an interrupted run"
        "$TF" -chdir="$root/infra/compute" force-unlock -force "$id"
    else
        echo "state is locked (${age} min old): another run is applying or destroying" >&2
        exit 1
    fi
fi

"$TF" -chdir="$root/infra/compute" destroy -auto-approve -input=false
