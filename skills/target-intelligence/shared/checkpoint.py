"""
Checkpoint system for target intelligence pipeline.
支持工作流暂停/恢复，避免重复计算。

Usage:
    from shared.checkpoint import CheckpointManager
    cm = CheckpointManager(gene="EGFR", cancer_type="LUAD", output_dir=Path("./output/EGFR"))

    # 检查某步骤是否已完成
    if cm.is_step_completed("p1_gtex"):
        data = cm.load_step_result("p1_gtex")
    else:
        data = run_gtex_analysis(...)
        cm.save_step_result("p1_gtex", data)
"""

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

PHASE_STEP_IDS = {"1": "phase1", "2": "phase2", "3": "phase3", "4": "phase4"}


class CheckpointManager:
    """Manages pipeline checkpoint state for pause/resume support."""

    def __init__(self, gene: str, cancer_type: str, output_dir: Path):
        self.gene = gene
        self.cancer_type = cancer_type
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.checkpoint_file = self.output_dir / "checkpoint.json"
        self._state = self._load()

    def _load(self) -> Dict:
        if self.checkpoint_file.exists():
            try:
                return json.loads(self.checkpoint_file.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, KeyError):
                pass
        return {
            "gene": self.gene,
            "cancer_type": self.cancer_type,
            "started_at": datetime.now().isoformat(),
            "last_updated": datetime.now().isoformat(),
            "completed_steps": [],
            "step_results": {},
            "phase_status": {
                "1": "pending",
                "2": "pending",
                "3": "pending",
                "4": "pending",
            },
        }

    def _save(self):
        self._state["last_updated"] = datetime.now().isoformat()
        self.checkpoint_file.write_text(
            json.dumps(self._state, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

    def is_step_completed(self, step_id: str) -> bool:
        return step_id in self._state["completed_steps"]

    def mark_step_completed(self, step_id: str, result_path: Optional[str] = None):
        if step_id not in self._state["completed_steps"]:
            self._state["completed_steps"].append(step_id)
        if result_path:
            self._state["step_results"][step_id] = result_path
        self._save()

    def save_step_result(self, step_id: str, data: Any):
        result_path = self.output_dir / "raw" / f"{step_id}_result.json"
        result_path.parent.mkdir(parents=True, exist_ok=True)
        result_path.write_text(
            json.dumps(data, indent=2, ensure_ascii=False, default=str),
            encoding="utf-8",
        )
        self.mark_step_completed(step_id, str(result_path))

    def load_step_result(self, step_id: str) -> Optional[Dict]:
        result_path = self._state["step_results"].get(step_id)
        if result_path and Path(result_path).exists():
            return json.loads(Path(result_path).read_text(encoding="utf-8"))
        return None

    def get_pending_steps(self, all_steps: List[str]) -> List[str]:
        return [s for s in all_steps if not self.is_step_completed(s)]

    def get_phase_status(self, phase: str) -> str:
        return self._state["phase_status"].get(phase, "pending")

    def set_phase_status(self, phase: str, status: str):
        self._state["phase_status"][phase] = status
        self._save()

    def get_summary(self) -> Dict:
        return {
            "gene": self._state["gene"],
            "cancer_type": self._state["cancer_type"],
            "started_at": self._state["started_at"],
            "last_updated": self._state["last_updated"],
            "completed_steps": len(self._state["completed_steps"]),
            "phase_status": self._state["phase_status"],
        }

    def reset(self):
        self._state = {
            "gene": self.gene,
            "cancer_type": self.cancer_type,
            "started_at": datetime.now().isoformat(),
            "last_updated": datetime.now().isoformat(),
            "completed_steps": [],
            "step_results": {},
            "phase_status": {"1": "pending", "2": "pending", "3": "pending", "4": "pending"},
        }
        self._save()

    def _phase_artifacts_exist(self, phase: str) -> bool:
        """Return True when key deliverables for a phase are on disk."""
        gene = self.gene
        cancer = self.cancer_type
        od = self.output_dir
        if phase == "1":
            return (
                (od / f"phase1_{gene}_{cancer}_report.json").exists()
                or any(od.glob(f"phase1_{gene}_*_report.json"))
            ) and (od / f"gtex_{gene}_expression.json").exists()
        if phase == "2":
            return any(od.glob("phase2_*_report.json")) and any(od.glob("target_priority_*.json"))
        if phase == "3":
            return (od / f"phase3_{gene}_report.json").exists() or (
                od / f"competitive_{gene}_intelligence.json"
            ).exists()
        if phase == "4":
            return (od / f"phase4_{gene}_report.json").exists() or (
                od / f"business_plan_{gene}.json"
            ).exists()
        return False

    def reconcile_phase_status(self, phase: Optional[str] = None) -> Dict[str, str]:
        """Sync phase_status with on-disk artifacts.

        When deliverables exist but status is error/pending, upgrade to completed
        and mark the corresponding step id. Returns changed phase -> status map.
        """
        phases = [phase] if phase else list(PHASE_STEP_IDS.keys())
        changed: Dict[str, str] = {}
        for p in phases:
            if not self._phase_artifacts_exist(p):
                continue
            current = self._state["phase_status"].get(p, "pending")
            if current in ("completed", "running"):
                step_id = PHASE_STEP_IDS[p]
                if not self.is_step_completed(step_id):
                    self.mark_step_completed(step_id)
                continue
            self._state["phase_status"][p] = "completed"
            step_id = PHASE_STEP_IDS[p]
            if not self.is_step_completed(step_id):
                self._state["completed_steps"].append(step_id)
            changed[p] = "completed"
        if changed:
            self._save()
        return changed
