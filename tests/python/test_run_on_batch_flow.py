"""run-on-batch.sh end to end with fake aws, terraform and nextflow (no AWS, no cost).

The fake aws keeps an in-memory "S3" as files under FAKE_S3 and logs every call; the fake
nextflow logs its arguments and environment, writes a .nextflow.log with a session UUID and
puts prepared Parquet results into the fake S3 results folder.
"""

import os
import re
import subprocess
import sys
from pathlib import Path

import pytest
from dataset_helpers import sample_record, summary_record, write_run

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "infra" / "scripts" / "run-on-batch.sh"
BUCKET = "amr-pipeline-123456789012"
UUID = "b1db330e-9839-4786-868e-38a1e6e1adc9"

FAKE_AWS = r"""#!/usr/bin/env python3
import os, shutil, sys
from pathlib import Path
s3 = Path(os.environ["FAKE_S3"])
with open(os.environ["FAKE_LOG"], "a") as log:
    log.write("aws " + " ".join(sys.argv[1:]) + "\n")
args = sys.argv[1:]
def local(uri):
    return s3 / uri.removeprefix("s3://")
if args[:2] == ["sts", "get-caller-identity"]:
    print("123456789012")
elif args[:2] == ["s3", "ls"]:
    print("2026-10-01 00:00:00 123 amrfinderdb-2026-08-07.1.tar.gz")
elif args[:2] == ["s3", "cp"]:
    src, dst = args[2], args[3]
    if "--recursive" in args:
        shutil.copytree(local(src), dst, dirs_exist_ok=True)
    elif src == "-":
        local(dst).parent.mkdir(parents=True, exist_ok=True)
        local(dst).write_bytes(sys.stdin.buffer.read())
    elif src.startswith("s3://"):
        if not local(src).exists():
            sys.exit(1)
        if dst == "-":
            sys.stdout.write(local(src).read_text())
        else:
            shutil.copy(local(src), dst)
    else:
        local(dst).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(src, local(dst))
else:
    print("0")
"""
FAKE_TF = """#!/usr/bin/env bash
case "$*" in
  *"output -raw bucket"*) echo amr-pipeline-123456789012 ;;
  *"output -raw runner_role_arn"*) echo arn:aws:iam::123456789012:role/amr-pipeline-runner ;;
  *"output -raw region"*) echo eu-west-1 ;;
  *"output -raw job_role_arn"*) echo arn:aws:iam::123456789012:role/amr-batch-job ;;
esac
"""
FAKE_NF = r"""#!/usr/bin/env bash
{ printf 'nextflow'; printf ' %s' "$@"; echo
  echo "env NXF_CLOUDCACHE_PATH=${NXF_CLOUDCACHE_PATH:-}"
  echo "env NXF_IGNORE_RESUME_HISTORY=${NXF_IGNORE_RESUME_HISTORY:-}"
} >> "$FAKE_LOG"
outdir=$(printf '%s\n' "$@" | grep -A1 -- '^--outdir$' | tail -1)
saved="$FAKE_S3/${outdir#s3://}/session-id"
echo "session saved before start: $(cat "$saved" 2> /dev/null || echo none)" >> "$FAKE_LOG"
mkdir -p "$FAKE_S3/${outdir#s3://}"
cp -R "$FAKE_RESULTS/." "$FAKE_S3/${outdir#s3://}/"
exit "${FAKE_NF_EXIT:-0}"
"""


@pytest.fixture
def fake(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name, body in {"aws": FAKE_AWS, "terraform": FAKE_TF, "nextflow": FAKE_NF}.items():
        (bin_dir / name).write_text(body)
        (bin_dir / name).chmod(0o755)
    # The installed amrtools of the interpreter running the tests (CI has no .venv), behind a
    # wrapper that logs each call so the tests see the script really used it.
    amrtools = Path(sys.executable).parent / "amrtools"
    (bin_dir / "amrtools-logged").write_text(
        f'#!/usr/bin/env bash\necho "amrtools $*" >> "$FAKE_LOG"\nexec "{amrtools}" "$@"\n'
    )
    (bin_dir / "amrtools-logged").chmod(0o755)
    sheet = tmp_path / "samples.csv"
    sheet.write_text("sample,fastq_1,fastq_2\n" + "".join(f"S{i},x,y\n" for i in range(1, 5)))
    env = {
        **os.environ,
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "FAKE_S3": str(tmp_path / "s3"),
        "FAKE_LOG": str(tmp_path / "calls.log"),
        "FAKE_RESULTS": str(tmp_path / "results"),
        "FAKE_UUID": UUID,
        "NXF": str(bin_dir / "nextflow"),
        "AMRTOOLS": str(bin_dir / "amrtools-logged"),
        "PYTHON": sys.executable,
        "RUNNER_AWS_ACCESS_KEY_ID": "x",
        "RUNNER_AWS_SECRET_ACCESS_KEY": "x",
        "RUNNER_AWS_SESSION_TOKEN": "x",
        "GITHUB_STEP_SUMMARY": str(tmp_path / "summary.md"),
    }
    return tmp_path, sheet, env


def _results(tmp_path, failed):
    samples = [
        sample_record(f"S{i}", analysis_status="failed" if f"S{i}" in failed else "complete")
        for i in range(1, 5)
    ]
    summaries = [summary_record(s["sample"]) for s in samples if s["sample"] not in failed]
    write_run(tmp_path / "results" / "parquet", samples, [], summaries)


def _run(env, *args):
    return subprocess.run(["bash", str(SCRIPT), "--ci", "--study", "pytest-flow", *args],
                          env=env, capture_output=True, text=True, timeout=120)  # fmt: skip


def _s3(tmp_path, key):
    return tmp_path / "s3" / BUCKET / key


def _calls(tmp_path):
    return (tmp_path / "calls.log").read_text()


def _run_id(proc):
    """The run id the script printed in its "nextflow on Batch ... run=<id> ..." line."""
    line = next(line for line in proc.stdout.splitlines() if " run=" in line)
    return line.split(" run=")[1].split()[0]


def test_one_failed_sample_still_succeeds_and_is_reported(fake):
    tmp, sheet, env = fake
    _results(tmp, {"S4"})
    proc = _run(env, "--input", str(sheet))
    assert proc.returncode == 0, proc.stdout + proc.stderr
    run_id = _run_id(proc)
    assert _s3(tmp, f"results/pytest-flow/{run_id}/_SUCCESS").exists()
    assert "1 of 4 samples failed: S4" in proc.stdout
    assert "1 of 4 samples failed: S4" in (tmp / "summary.md").read_text()
    assert "amrtools run-status" in _calls(tmp)


def test_too_many_failures_fail_the_run_without_success_marker(fake):
    tmp, sheet, env = fake
    _results(tmp, {"S3", "S4"})
    proc = _run(env, "--input", str(sheet))
    assert proc.returncode != 0
    assert "more than 25%" in proc.stderr  # refused by run-status, not by a missing tool
    assert not list((tmp / "s3").rglob("_SUCCESS"))


def test_new_run_saves_samplesheet_and_session_and_uses_the_cloud_cache(fake):
    tmp, sheet, env = fake
    _results(tmp, set())
    proc = _run(env, "--input", str(sheet))
    assert proc.returncode == 0, proc.stdout + proc.stderr
    run_id = _run_id(proc)
    run = f"results/pytest-flow/{run_id}"
    assert _s3(tmp, f"{run}/samplesheet.csv").read_text() == sheet.read_text()
    # The session id is chosen and saved before Nextflow starts: a cancelled or timed-out
    # GitHub job is killed before any exit handler could save it.
    session = _s3(tmp, f"{run}/session-id").read_text().strip()
    calls = _calls(tmp)
    assert re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}", session)
    assert f"session saved before start: {session}" in calls
    assert f" -resume {session}" in calls
    assert f"NXF_CLOUDCACHE_PATH=s3://{BUCKET}/cache/pytest-flow/{run_id}" in calls
    assert "NXF_IGNORE_RESUME_HISTORY=true" in calls
    assert " -name " in calls


def test_resume_reuses_the_run_samplesheet_work_dir_and_session(fake):
    tmp, sheet, env = fake
    _results(tmp, set())
    run_id = "20261009T010000Z"
    run = f"results/pytest-flow/{run_id}"
    _s3(tmp, run).mkdir(parents=True)
    _s3(tmp, f"{run}/samplesheet.csv").write_text(sheet.read_text())
    _s3(tmp, f"{run}/session-id").write_text(UUID + "\n")
    proc = _run(env, "--resume", run_id)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    calls = _calls(tmp)
    assert f" -resume {UUID}" in calls
    assert f"-work-dir s3://{BUCKET}/work/pytest-flow/{run_id}" in calls
    assert f"NXF_CLOUDCACHE_PATH=s3://{BUCKET}/cache/pytest-flow/{run_id}" in calls


def test_resume_without_a_saved_session_is_refused(fake):
    _, _, env = fake
    proc = _run(env, "--resume", "20261009T010000Z")
    assert proc.returncode != 0
    assert "cannot resume" in proc.stderr


@pytest.mark.parametrize("bad", ["latest", "2026-10-09", "../x"])
def test_resume_id_must_look_like_a_run_id(fake, bad):
    _, _, env = fake
    proc = _run(env, "--resume", bad)
    assert proc.returncode == 2


@pytest.fixture(autouse=True)
def _clean_runs():
    yield
    subprocess.run(["rm", "-rf", str(ROOT / "runs" / "pytest-flow")], check=False)
