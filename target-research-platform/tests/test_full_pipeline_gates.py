from __future__ import annotations

import argparse
import json
from pathlib import Path
from unittest.mock import MagicMock

import main as pipeline_main


def _full_args(tmp_path: Path) -> argparse.Namespace:
    return argparse.Namespace(
        target="KRAS",
        disease="pancreatic cancer",
        cancers=["PAAD"],
        ensg=None,
        output=str(tmp_path / "output"),
        cache=str(tmp_path / "cache"),
        modality="small_molecule",
        risk_level="medium",
        json=True,
        _tracker=None,
        _run_id="test-run",
    )


def test_full_pipeline_stops_and_checkpoints_after_stage1_gate(
    tmp_path: Path,
    monkeypatch,
):
    monkeypatch.setattr(
        pipeline_main,
        "run_stage1",
        MagicMock(return_value={
            "success": False,
            "stage": "stage1",
            "summary": {
                "analysis_status": "blocked",
                "evidence_issues": ["HPA evidence is empty."],
            },
        }),
    )
    stage2 = MagicMock()
    monkeypatch.setattr(pipeline_main, "run_stage2", stage2)

    result = pipeline_main.run_full_pipeline(_full_args(tmp_path))

    assert result["success"] is False
    assert result["stages"]["stage2"]["status"] == "skipped"
    stage2.assert_not_called()
    checkpoint_path = Path(result["artifacts"]["pipeline_checkpoint"])
    checkpoint = json.loads(checkpoint_path.read_text(encoding="utf-8"))
    assert checkpoint["schema"] == "medscale.pipeline_checkpoint.v1"
    assert checkpoint["status"] == "blocked"
    assert checkpoint["current_stage"] == "stage1"
    assert checkpoint["stages"]["stage2"]["status"] == "skipped"


def test_full_pipeline_stops_after_stage2_gate(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(
        pipeline_main,
        "run_stage1",
        MagicMock(return_value={"success": True, "stage": "stage1"}),
    )
    monkeypatch.setattr(
        pipeline_main,
        "run_stage2",
        MagicMock(return_value={
            "success": False,
            "stage": "stage2",
            "validation": {
                "issues": ["TCGA control group has fewer than 5 samples."]
            },
        }),
    )
    stage3 = MagicMock()
    monkeypatch.setattr(pipeline_main, "run_stage3", stage3)

    result = pipeline_main.run_full_pipeline(_full_args(tmp_path))

    assert result["success"] is False
    assert result["stages"]["stage3"]["status"] == "skipped"
    stage3.assert_not_called()
