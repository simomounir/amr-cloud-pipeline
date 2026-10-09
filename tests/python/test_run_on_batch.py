"""run-on-batch.sh argument guards and the compute-ownership marker, with fake aws/terraform."""

import os
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "infra" / "scripts" / "run-on-batch.sh"

FAKE_AWS = """#!/usr/bin/env bash
case "$*" in
  *get-caller-identity*) echo 123456789012 ;;
  *describe-compute-environments*) echo "${FAKE_EXISTING:-0}" ;;
  *) echo 0 ;;
esac
"""
FAKE_TF = """#!/usr/bin/env bash
case "$*" in
  *"output -raw bucket"*) echo amr-pipeline-123456789012 ;;
  *"output -raw runner_role_arn"*) echo arn:aws:iam::123456789012:role/amr-pipeline-runner ;;
  *"output -raw region"*) echo eu-west-1 ;;
  *" apply "*) exit 1 ;;
esac
"""


@pytest.fixture
def fake_env(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name, body in {"aws": FAKE_AWS, "terraform": FAKE_TF}.items():
        (bin_dir / name).write_text(body)
        (bin_dir / name).chmod(0o755)
    sheet = tmp_path / "samples.csv"
    sheet.write_text("sample,fastq_1,fastq_2\na,x,y\n")
    env = {
        **os.environ,
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "AMR_COMPUTE_MARKER": str(tmp_path / "owned"),
        "RUNNER_AWS_ACCESS_KEY_ID": "x",
        "RUNNER_AWS_SECRET_ACCESS_KEY": "x",
        "RUNNER_AWS_SESSION_TOKEN": "x",
    }
    return tmp_path, sheet, env


def _run(sheet, env, *extra):
    return subprocess.run(
        ["bash", str(SCRIPT), "--ci", "--study", "pytest-guard", "--input", str(sheet), *extra],
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )


@pytest.mark.parametrize("value", ["0", "-3", "abc"])
def test_max_samples_must_be_positive(fake_env, value):
    _, sheet, env = fake_env
    proc = _run(sheet, env, "--max-samples", value)
    assert proc.returncode == 2
    assert "--max-samples" in proc.stderr


def test_refusing_because_compute_exists_leaves_no_marker(fake_env):
    tmp, sheet, env = fake_env
    proc = _run(sheet, {**env, "FAKE_EXISTING": "1"})
    assert proc.returncode == 1
    assert "compute already exists" in proc.stderr
    assert not (tmp / "owned").exists()


def test_marker_is_written_before_apply(fake_env):
    tmp, sheet, env = fake_env
    proc = _run(sheet, env)  # the fake terraform fails the apply
    assert proc.returncode != 0
    assert (tmp / "owned").exists()


@pytest.fixture(autouse=True)
def _clean_runs():
    yield
    subprocess.run(["rm", "-rf", str(ROOT / "runs" / "pytest-guard")], check=False)


DESTROY = ROOT / "infra" / "scripts" / "destroy-compute.sh"


def _destroy(tmp_path, lock_age_minutes, *args):
    from datetime import UTC, datetime, timedelta

    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    created = (datetime.now(UTC) - timedelta(minutes=lock_age_minutes)).strftime(
        "%Y-%m-%dT%H:%M:%S.%f000Z"
    )
    (bin_dir / "aws").write_text(f"""#!/usr/bin/env bash
case "$*" in
  *get-caller-identity*) echo 123456789012 ;;
  *tflock*) echo '{{"ID":"lock-1","Created":"{created}"}}' ;;
esac
""")
    (bin_dir / "terraform").write_text(f'#!/usr/bin/env bash\necho "$*" >> {tmp_path}/tf.log\n')
    for f in bin_dir.iterdir():
        f.chmod(0o755)
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}"}
    proc = subprocess.run(
        ["bash", str(DESTROY), *args], env=env, capture_output=True, text=True, timeout=60
    )
    calls = (tmp_path / "tf.log").read_text() if (tmp_path / "tf.log").exists() else ""
    return proc, calls


def test_stale_lock_is_released_before_destroy(tmp_path):
    proc, calls = _destroy(tmp_path, 90, "--unlock-after", "60")
    assert proc.returncode == 0, proc.stderr
    assert "force-unlock -force lock-1" in calls
    assert calls.index("force-unlock") < calls.index("destroy")


def test_fresh_lock_is_left_alone(tmp_path):
    proc, calls = _destroy(tmp_path, 5, "--unlock-after", "60")
    assert proc.returncode == 1
    assert "force-unlock" not in calls and "destroy" not in calls


def test_without_unlock_after_the_lock_is_not_touched(tmp_path):
    proc, calls = _destroy(tmp_path, 90)
    assert "force-unlock" not in calls and "destroy" in calls
