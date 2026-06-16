from __future__ import annotations

import json
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any


STAGE_SEQUENCE = ["stage1", "stage2", "stage3", "stage4"]
STAGE_LABELS = {
    "stage1": "Stage 1 Expression",
    "stage2": "Stage 2 Screening",
    "stage3": "Stage 3 Deep Research",
    "stage4": "Stage 4 Business",
}


def _now_iso() -> str:
    return datetime.now().isoformat()


def _sanitize_json(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): _sanitize_json(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_sanitize_json(item) for item in value]
    if isinstance(value, tuple):
        return [_sanitize_json(item) for item in value]
    if isinstance(value, Path):
        return str(value)
    if hasattr(value, "item") and callable(value.item):
        try:
            return value.item()
        except Exception:
            return str(value)
    return value


def build_idle_status() -> dict[str, Any]:
    return {
        "run_id": None,
        "status": "idle",
        "target": "",
        "disease": "",
        "cancers": [],
        "modality": "",
        "risk_level": "",
        "progress_percent": 0,
        "current_stage": None,
        "current_stage_label": None,
        "started_at": None,
        "finished_at": None,
        "updated_at": _now_iso(),
        "output_root": "",
        "summary": {},
        "artifacts": {},
        "logs": [],
        "stages": {
            stage: {
                "label": STAGE_LABELS[stage],
                "status": "pending",
                "started_at": None,
                "finished_at": None,
                "metrics": {},
                "error": None,
            }
            for stage in STAGE_SEQUENCE
        },
    }


class LiveStatusTracker:
    def __init__(self, status_file: str | Path):
        self.status_file = Path(status_file)
        self.status_file.parent.mkdir(parents=True, exist_ok=True)
        self.state = self._load_existing_state() or build_idle_status()
        if not self.status_file.exists():
            self._write()

    def _load_existing_state(self) -> dict[str, Any] | None:
        if not self.status_file.exists():
            return None
        try:
            payload = json.loads(self.status_file.read_text(encoding="utf-8"))
            return payload if isinstance(payload, dict) else None
        except Exception:
            return None

    def start_run(self, metadata: dict[str, Any]) -> None:
        self.state = build_idle_status()
        self.state.update(
            {
                "run_id": metadata.get("run_id"),
                "status": "running",
                "target": metadata.get("target", ""),
                "disease": metadata.get("disease", ""),
                "cancers": metadata.get("cancers", []),
                "modality": metadata.get("modality", ""),
                "risk_level": metadata.get("risk_level", ""),
                "started_at": _now_iso(),
                "updated_at": _now_iso(),
                "output_root": metadata.get("output_root", ""),
            }
        )
        self.log(
            f"Run started for {self.state['target']} / {self.state['disease']}",
            level="info",
        )
        self._write()

    def log(self, message: str, level: str = "info") -> None:
        self.state["logs"].append(
            {
                "timestamp": _now_iso(),
                "level": level,
                "message": message,
            }
        )
        self.state["logs"] = self.state["logs"][-200:]
        self.state["updated_at"] = _now_iso()
        self._write()

    def start_stage(self, stage: str, progress_percent: int) -> None:
        stage_state = self.state["stages"][stage]
        stage_state["status"] = "running"
        stage_state["started_at"] = _now_iso()
        stage_state["error"] = None
        self.state["status"] = "running"
        self.state["current_stage"] = stage
        self.state["current_stage_label"] = STAGE_LABELS[stage]
        self.state["progress_percent"] = progress_percent
        self.log(f"{STAGE_LABELS[stage]} started")

    def complete_stage(self, stage: str, result: dict[str, Any], progress_percent: int) -> None:
        stage_state = self.state["stages"][stage]
        stage_state["status"] = "completed" if result.get("success") else "failed"
        stage_state["finished_at"] = _now_iso()
        stage_state["metrics"] = self._extract_stage_metrics(stage, result)
        if not result.get("success"):
            stage_state["error"] = result.get("error")
        self.state["progress_percent"] = progress_percent
        self.state["updated_at"] = _now_iso()
        outcome = "completed" if result.get("success") else "failed"
        self.log(f"{STAGE_LABELS[stage]} {outcome}")
        self._write()

    def fail_stage(self, stage: str, error_message: str) -> None:
        stage_state = self.state["stages"][stage]
        stage_state["status"] = "failed"
        stage_state["finished_at"] = _now_iso()
        stage_state["error"] = error_message
        self.state["status"] = "failed"
        self.state["current_stage"] = stage
        self.state["current_stage_label"] = STAGE_LABELS[stage]
        self.log(f"{STAGE_LABELS[stage]} failed: {error_message}", level="error")
        self._write()

    def finish_run(self, summary: dict[str, Any], artifacts: dict[str, Any]) -> None:
        self.state["status"] = "completed"
        self.state["progress_percent"] = 100
        self.state["current_stage"] = None
        self.state["current_stage_label"] = None
        self.state["finished_at"] = _now_iso()
        self.state["summary"] = _sanitize_json(summary)
        self.state["artifacts"] = _sanitize_json(artifacts)
        self.log("Run completed")
        self._write()

    def fail_run(self, error_message: str) -> None:
        self.state["status"] = "failed"
        self.state["finished_at"] = _now_iso()
        self.state["updated_at"] = _now_iso()
        self.log(f"Run failed: {error_message}", level="error")
        self._write()

    def snapshot(self) -> dict[str, Any]:
        return deepcopy(self.state)

    def _extract_stage_metrics(self, stage: str, result: dict[str, Any]) -> dict[str, Any]:
        summary = result.get("summary", {})
        if stage == "stage1":
            return {
                "confidence_level": summary.get("confidence_level"),
                "data_sources": summary.get("data_sources", []),
                "key_findings": summary.get("key_findings", [])[:3],
            }
        if stage == "stage2":
            candidates = summary.get("top_candidates", [])
            top_candidate = candidates[0] if candidates else {}
            return {
                "candidate_count": len(candidates),
                "top_candidate": top_candidate.get("gene"),
                "top_score": top_candidate.get("score"),
                "data_sources": summary.get("data_sources", []),
            }
        if stage == "stage3":
            developability = summary.get("developability", {})
            return {
                "developability_score": developability.get("score"),
                "developability_level": developability.get("level"),
                "recommendations": summary.get("recommendations", [])[:3],
                "trial_count": self._extract_trial_count(result),
            }
        if stage == "stage4":
            milestones = summary.get("milestones", {})
            return {
                "success_rate": milestones.get("success_rate"),
                "total_duration": milestones.get("total_duration"),
                "total_cost": milestones.get("total_cost"),
                "estimated_completion": milestones.get("estimated_completion"),
            }
        return _sanitize_json(summary)

    def _extract_trial_count(self, result: dict[str, Any]) -> Any:
        clinical = (
            result.get("stages", {})
            .get("clinical_pipeline", {})
            .get("data", {})
        )
        if "total_trials" in clinical:
            return clinical.get("total_trials")
        competitive = (
            result.get("stages", {})
            .get("competitive_landscape", {})
            .get("data", {})
            .get("sections", {})
            .get("clinical_pipeline", {})
        )
        return competitive.get("total_trials")

    def _write(self) -> None:
        self.state["updated_at"] = _now_iso()
        self.status_file.write_text(
            json.dumps(_sanitize_json(self.state), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
