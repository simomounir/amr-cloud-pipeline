"""amrtools run-status: how many samples of a run failed, and is that too many."""

from dataset_helpers import sample_record, summary_record, write_run

from amrtools.cli import main


def _run(tmp_path, n_samples, failed):
    samples = [
        sample_record(f"S{i}", analysis_status="failed" if f"S{i}" in failed else "complete")
        for i in range(1, n_samples + 1)
    ]
    summaries = [summary_record(s["sample"]) for s in samples if s["sample"] not in failed]
    return write_run(tmp_path / "run", samples, [], summaries)


def test_no_failures(tmp_path, capsys):
    assert main(["run-status", str(_run(tmp_path, 3, set()))]) == 0
    assert "0 of 3 samples failed" in capsys.readouterr().out


def test_few_failures_are_reported_but_pass(tmp_path, capsys):
    assert main(["run-status", str(_run(tmp_path, 4, {"S4"}))]) == 0
    assert "1 of 4 samples failed: S4" in capsys.readouterr().out


def test_more_than_a_quarter_failed_is_an_error(tmp_path, capsys):
    assert main(["run-status", str(_run(tmp_path, 4, {"S3", "S4"}))]) == 1
    captured = capsys.readouterr()
    assert "2 of 4 samples failed: S3, S4" in captured.out
    assert "more than 25%" in captured.err


def test_threshold_is_configurable(tmp_path):
    run = _run(tmp_path, 4, {"S3", "S4"})
    assert main(["run-status", str(run), "--max-failed-fraction", "0.5"]) == 0
