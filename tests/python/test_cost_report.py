import importlib.util
from datetime import UTC, datetime
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location(
    "cost_report", Path(__file__).resolve().parents[2] / "infra" / "scripts" / "cost_report.py"
)
cost_report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cost_report)

T0 = datetime(2026, 10, 8, 18, 0, tzinfo=UTC)


def instance(iid, itype, az, launch, reason):
    return {
        "InstanceId": iid,
        "InstanceType": itype,
        "Placement": {"AvailabilityZone": az},
        "LaunchTime": launch,
        "StateTransitionReason": reason,
        "State": {"Name": "terminated"},
    }


PRICES = [
    {"InstanceType": "c6i.xlarge", "AvailabilityZone": "eu-west-1a", "SpotPrice": "0.0800",
     "Timestamp": "2026-10-08T12:00:00+00:00"},
    {"InstanceType": "c6i.xlarge", "AvailabilityZone": "eu-west-1a", "SpotPrice": "0.0700",
     "Timestamp": "2026-10-08T17:30:00+00:00"},
    {"InstanceType": "c6i.xlarge", "AvailabilityZone": "eu-west-1a", "SpotPrice": "0.0900",
     "Timestamp": "2026-10-08T19:00:00+00:00"},
]  # fmt: skip


def test_termination_time_parsed_from_state_reason():
    reason = "Service initiated (2026-10-08 18:30:00 GMT)"
    assert cost_report.terminated_at(reason) == datetime(2026, 10, 8, 18, 30, tzinfo=UTC)
    assert cost_report.terminated_at("") is None


def test_price_in_effect_at_launch():
    assert cost_report.spot_price(PRICES, "c6i.xlarge", "eu-west-1a", T0) == pytest.approx(0.07)


def test_instance_cost_includes_compute_disk_and_ip():
    inst = instance("i-1", "c6i.xlarge", "eu-west-1a", "2026-10-08T18:00:00+00:00",
                    "Service initiated (2026-10-08 18:30:00 GMT)")  # fmt: skip
    (row,) = cost_report.instance_costs([inst], PRICES, now=T0)
    assert row["hours"] == pytest.approx(0.5)
    assert row["compute_usd"] == pytest.approx(0.035)
    disk = (
        0.5 * cost_report.DISK_GB * cost_report.GP3_USD_PER_GB_MONTH / cost_report.HOURS_PER_MONTH
    )
    assert row["disk_usd"] == pytest.approx(disk)
    assert row["ip_usd"] == pytest.approx(0.5 * cost_report.PUBLIC_IPV4_USD_PER_HOUR)


def test_spot_billing_minimum_is_one_minute():
    inst = instance("i-2", "c6i.xlarge", "eu-west-1a", "2026-10-08T18:00:00+00:00",
                    "Service initiated (2026-10-08 18:00:10 GMT)")  # fmt: skip
    (row,) = cost_report.instance_costs([inst], PRICES, now=T0)
    assert row["hours"] == pytest.approx(1 / 60)


def test_running_instance_is_priced_until_now():
    inst = instance("i-3", "c6i.xlarge", "eu-west-1a", "2026-10-08T18:00:00+00:00", "")
    inst["State"] = {"Name": "running"}
    now = datetime(2026, 10, 8, 18, 15, tzinfo=UTC)
    (row,) = cost_report.instance_costs([inst], PRICES, now=now)
    assert row["hours"] == pytest.approx(0.25)


def test_summary_per_sample():
    rows = [{"compute_usd": 0.03, "disk_usd": 0.01, "ip_usd": 0.002, "hours": 0.5}]
    summary = cost_report.summarise(rows, samples=3)
    assert summary["total_usd"] == pytest.approx(0.042)
    assert summary["per_sample_usd"] == pytest.approx(0.014)
    assert summary["instance_hours"] == pytest.approx(0.5)


def test_main_prints_without_samples(monkeypatch, capsys):
    launched = "2026-10-08T18:00:00+00:00"
    inst = instance("i-1", "c6i.xlarge", "eu-west-1a", launched,
                    "Service initiated (2026-10-08 18:30:00 GMT)")  # fmt: skip
    responses = {
        "describe-instances": {"Reservations": [{"Instances": [inst]}]},
        "describe-spot-price-history": {"SpotPriceHistory": PRICES},
    }
    monkeypatch.setattr(cost_report, "_aws", lambda *args: responses[args[1]])
    assert cost_report.main(["--region", "eu-west-1", "--since", "2026-10-08T17:00:00Z",
                             "--samples", "0"]) == 0  # fmt: skip
    assert "per sample: n/a" in capsys.readouterr().out
