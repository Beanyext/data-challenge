import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

import common  # noqa: E402


@pytest.fixture(autouse=True)
def isolated_output(tmp_path, monkeypatch):
    monkeypatch.setattr(common, "REPORTS", tmp_path / "reports")
    monkeypatch.setattr(common, "OUTPUTS", tmp_path / "outputs")
