import amrtools


def test_package_version():
    assert amrtools.__version__ == "0.5.0"


def test_amrtools_image_tag_matches_package_version():
    """The pipeline and CI must use the image of this package version (CI publishes it)."""
    import re
    import tomllib
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    version = tomllib.loads((root / "pyproject.toml").read_text())["project"]["version"]
    image = f"ghcr.io/simomounir/amrtools:{version}"
    assert f"amrtools_container     = '{image}'" in (root / "nextflow.config").read_text()
    for workflow in (root / ".github" / "workflows").glob("*.yml"):
        for pinned in re.findall(r"AMRTOOLS_IMAGE: (\S+)", workflow.read_text()):
            assert pinned == image, workflow.name
