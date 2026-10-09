"""Guards on the GitHub workflows that can reach AWS."""

import json
import os
import re
import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github" / "workflows"

# Jobs allowed to request a GitHub OIDC token without a deployment environment. AWS trusts any
# token from main of this repository, so every other job must stay without one.
AWS_JOBS = {("cloud-run.yml", "run"), ("janitor.yml", "janitor")}


def _load(name: str) -> dict:
    return yaml.safe_load((WORKFLOWS / name).read_text())


def _id_token(permissions) -> bool:
    return isinstance(permissions, dict) and permissions.get("id-token") == "write"


def test_only_aws_jobs_can_get_an_oidc_token():
    offenders = []
    for path in sorted(WORKFLOWS.glob("*.y*ml")):
        workflow = yaml.safe_load(path.read_text())
        if _id_token(workflow.get("permissions")) and len(workflow["jobs"]) > 1:
            offenders.append(f"{path.name}: workflow-level id-token")
        for job_id, job in workflow["jobs"].items():
            wants = _id_token(job.get("permissions")) or (
                _id_token(workflow.get("permissions")) and "permissions" not in job
            )
            # A job with a deployment environment gets a different OIDC subject, which AWS refuses.
            if wants and "environment" not in job and (path.name, job_id) not in AWS_JOBS:
                offenders.append(f"{path.name}: {job_id}")
    assert offenders == []


@pytest.mark.parametrize("name", ["cloud-run.yml", "janitor.yml"])
def test_role_arns_come_from_secrets_and_account_id_is_masked(name):
    steps = [s for job in _load(name)["jobs"].values() for s in job["steps"]]
    creds = [s for s in steps if "configure-aws-credentials" in s.get("uses", "")]
    assert creds
    for step in creds:
        assert step["with"]["role-to-assume"].startswith("${{ secrets.")
        assert step["with"]["mask-aws-account-id"] is True


def _study_settings_script() -> str:
    steps = _load("cloud-run.yml")["jobs"]["run"]["steps"]
    return next(s for s in steps if s.get("name") == "Read study settings")["run"]


@pytest.fixture
def study_dir(tmp_path):
    def make(max_isolates: str, organism: str = "Klebsiella_pneumoniae") -> Path:
        d = tmp_path / "studies" / "s1"
        d.mkdir(parents=True)
        (d / "study.yaml").write_text(
            f"title: t\norganism: {organism}\nmax_isolates: {max_isolates}\n"
        )
        (d / "accessions.txt").write_text("SRR1\n")
        return tmp_path

    return make


def _settings(cwd: Path, requested: str = "") -> subprocess.CompletedProcess:
    out = cwd / "out.txt"
    out.write_text("")
    env = {
        **os.environ,
        "STUDY": "s1",
        "REQUESTED": requested,
        "GITHUB_OUTPUT": str(out),
        "GITHUB_STEP_SUMMARY": str(cwd / "summary.txt"),
    }
    proc = subprocess.run(
        ["bash", "-e", "-c", _study_settings_script()],
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
    )
    proc.outputs = dict(line.split("=", 1) for line in out.read_text().splitlines())
    return proc


def test_study_cap_applies_when_nothing_requested(study_dir):
    proc = _settings(study_dir("5"))
    assert proc.returncode == 0, proc.stderr
    assert proc.outputs["max"] == "5"


def test_lower_request_wins_and_leading_zeros_are_decimal(study_dir):
    proc = _settings(study_dir("50"), requested="08")
    assert proc.returncode == 0, proc.stderr
    assert proc.outputs["max"] == "8"


def test_request_above_cap_is_capped(study_dir):
    assert _settings(study_dir("5"), requested="9").outputs["max"] == "5"


@pytest.mark.parametrize(("cap", "requested"), [("0", ""), ("5", "0"), ("5", "-1"), ("x", "")])
def test_zero_or_invalid_caps_are_refused(study_dir, cap, requested):
    assert _settings(study_dir(cap), requested=requested).returncode != 0


def test_organism_must_be_a_plain_name(study_dir):
    assert _settings(study_dir("5", organism='Kleb"; rm -rf /')).returncode != 0


def _run_step(tmp_path, resume: str) -> subprocess.CompletedProcess:
    """Run the "Run on AWS Batch" step with a stand-in run-on-batch.sh that echoes its args."""
    fake = tmp_path / "infra" / "scripts" / "run-on-batch.sh"
    fake.parent.mkdir(parents=True)
    fake.write_text('#!/usr/bin/env bash\necho "ARGS $*"\n')
    fake.chmod(0o755)
    steps = _load("cloud-run.yml")["jobs"]["run"]["steps"]
    script = next(s for s in steps if s.get("name") == "Run on AWS Batch")["run"]
    script = script.replace("${{ steps.study.outputs.max }}", "5")
    env = {**os.environ, "STUDY": "s1", "RESUME": resume}
    return subprocess.run(["bash", "-e", "-c", script], cwd=tmp_path, env=env,
                          capture_output=True, text=True)  # fmt: skip


def test_new_run_passes_the_samplesheet_and_cap(tmp_path):
    proc = _run_step(tmp_path, "")
    assert "ARGS --ci --study s1 --input input/samples.csv --max-samples 5" in proc.stdout


def test_resume_passes_only_the_run_id(tmp_path):
    proc = _run_step(tmp_path, "20261009T002544Z")
    assert "ARGS --ci --study s1 --resume 20261009T002544Z" in proc.stdout


def test_malformed_resume_id_is_refused(tmp_path):
    proc = _run_step(tmp_path, "latest; rm -rf /")
    assert proc.returncode != 0 and "ARGS" not in proc.stdout


def test_site_studies_are_pinned_in_git():
    """The site shows the releases listed in dashboard/studies.json; publishing is a commit.

    Pages deployments are identified by commit: a release alone (same commit) redeployed the
    old site on 2026-10-09.
    """
    entries = json.loads((ROOT / "dashboard" / "studies.json").read_text())
    assert entries and all(re.fullmatch(r"[a-z0-9][a-z0-9-]*", e["study"]) for e in entries)
    assert all(
        re.fullmatch(r"dataset-([a-z0-9-]+-)?\d{4}-\d{2}-\d{2}", e["release"]) for e in entries
    )
    assert not (ROOT / "dashboard" / "dataset.txt").exists()
    pages = _load("pages.yml")
    assert "release" not in pages[True]  # yaml reads the `on:` key as True
    assert "dashboard/**" in pages[True]["push"]["paths"]
    steps = pages["jobs"]["build"]["steps"]
    download = next(s for s in steps if s.get("name", "").startswith("Download"))
    script = download["run"]
    assert download["shell"] == "bash"  # bash -eo pipefail: a failing jq in the pipe fails the step
    assert "map(.study) | length == (unique | length)" in script  # duplicate study names
    assert "dashboard/studies.json" in script and "public/data/$study" in script
