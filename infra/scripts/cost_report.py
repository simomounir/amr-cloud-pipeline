#!/usr/bin/env python3
"""Estimate what a Batch run cost from the EC2 instances it used.

Prices each instance (tag Project=amr-cloud-pipeline, launched since --since) with the spot
price in effect at launch, plus its 100 GB gp3 disk and public IPv4 address, and divides by
the number of samples. Run it before the compute environment is destroyed (terminated
instances stay visible for about an hour). Cost Explorer has the billed figure a day later.

Usage: cost_report.py --region eu-west-1 --since 2026-10-08T18:00:00Z --samples 3 [--json out.json]
"""

import argparse
import json
import re
import subprocess
import sys
from datetime import UTC, datetime, timedelta

DISK_GB = 100  # launch template root volume (infra/compute/batch.tf)
GP3_USD_PER_GB_MONTH = 0.088  # eu-west-1
PUBLIC_IPV4_USD_PER_HOUR = 0.005
HOURS_PER_MONTH = 730
MIN_BILLED = timedelta(seconds=60)  # Linux spot: per second, 60 s minimum

_TERMINATED = re.compile(r"\((\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) GMT\)")


def _ts(value) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def terminated_at(reason: str) -> datetime | None:
    match = _TERMINATED.search(reason or "")
    if not match:
        return None
    return datetime.strptime(match[1], "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC)


def spot_price(history: list[dict], itype: str, az: str, at: datetime) -> float:
    entries = sorted(
        (e for e in history if e["InstanceType"] == itype and e["AvailabilityZone"] == az),
        key=lambda e: _ts(e["Timestamp"]),
    )
    effective = [e for e in entries if _ts(e["Timestamp"]) <= at] or entries[:1]
    if not effective:
        raise ValueError(f"no spot price for {itype} in {az}")
    return float(effective[-1]["SpotPrice"])


def instance_costs(instances: list[dict], history: list[dict], now: datetime) -> list[dict]:
    rows = []
    for inst in instances:
        launched = _ts(inst["LaunchTime"])
        ended = terminated_at(inst.get("StateTransitionReason", "")) or now
        billed = max(ended - launched, MIN_BILLED)
        hours = billed.total_seconds() / 3600
        az = inst["Placement"]["AvailabilityZone"]
        price = spot_price(history, inst["InstanceType"], az, launched)
        rows.append(
            {
                "instance": inst["InstanceId"],
                "type": inst["InstanceType"],
                "az": az,
                "hours": hours,
                "spot_usd_per_hour": price,
                "compute_usd": hours * price,
                "disk_usd": hours * DISK_GB * GP3_USD_PER_GB_MONTH / HOURS_PER_MONTH,
                "ip_usd": hours * PUBLIC_IPV4_USD_PER_HOUR,
            }
        )
    return rows


def summarise(rows: list[dict], samples: int) -> dict:
    total = sum(r["compute_usd"] + r["disk_usd"] + r["ip_usd"] for r in rows)
    return {
        "instances": len(rows),
        "instance_hours": sum(r["hours"] for r in rows),
        "total_usd": total,
        "samples": samples,
        "per_sample_usd": total / samples if samples else None,
    }


def _aws(*args: str) -> dict:
    out = subprocess.run(
        ["aws", *args, "--output", "json"], check=True, capture_output=True, text=True
    )
    return json.loads(out.stdout)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--region", required=True)
    parser.add_argument("--since", required=True, help="ISO time the run started")
    parser.add_argument("--samples", type=int, required=True)
    parser.add_argument("--json", help="also write the report to this file")
    args = parser.parse_args(argv)
    since = _ts(args.since)
    now = datetime.now(UTC)

    reservations = _aws(
        "ec2", "describe-instances", "--region", args.region,
        "--filters", "Name=tag:Project,Values=amr-cloud-pipeline",
    )["Reservations"]  # fmt: skip
    instances = [i for r in reservations for i in r["Instances"] if _ts(i["LaunchTime"]) >= since]
    if not instances:
        print(
            "no instances found for this run (were they terminated over an hour ago?)",
            file=sys.stderr,
        )
        return 1
    history = _aws(
        "ec2", "describe-spot-price-history", "--region", args.region,
        "--product-descriptions", "Linux/UNIX",
        "--instance-types", *sorted({i["InstanceType"] for i in instances}),
        "--start-time", (since - timedelta(days=1)).isoformat(), "--end-time", now.isoformat(),
    )["SpotPriceHistory"]  # fmt: skip
    rows = instance_costs(instances, history, now)
    summary = summarise(rows, args.samples)
    for r in rows:
        cost = r["compute_usd"] + r["disk_usd"] + r["ip_usd"]
        minutes = r["hours"] * 60
        print(
            f"{r['instance']} {r['type']:12} {r['az']} {minutes:6.1f} min "
            f"@ ${r['spot_usd_per_hour']:.4f}/h -> ${cost:.4f}"
        )
    print(
        f"total ${summary['total_usd']:.4f} for {args.samples} samples "
        f"= ${summary['per_sample_usd']:.4f} per sample "
        f"({summary['instance_hours']:.2f} instance-hours)"
    )
    if args.json:
        with open(args.json, "w") as handle:
            json.dump({"summary": summary, "instances": rows}, handle, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
