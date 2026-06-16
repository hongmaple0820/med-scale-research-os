"""
Celery 异步任务队列 — 支持靶点情报分析的长时间运行。

使用方式:
    # 启动 worker:
    # celery -A shared.tasks worker --loglevel=info -Q target_intelligence

    # 提交任务:
    from shared.tasks import run_full_analysis
    result = run_full_analysis.delay("KRAS", "Pancreatic Cancer")
    print(result.id)  # 任务 ID，可用于查询进度
"""
import os
import sys
import json
import subprocess
from pathlib import Path
from datetime import datetime

# Celery 配置
CELERY_BROKER = os.environ.get("CELERY_BROKER_URL", "redis://localhost:6379/0")
CELERY_RESULT = os.environ.get("CELERY_RESULT_BACKEND", "redis://localhost:6379/1")

try:
    from celery import Celery
    app = Celery(
        "target_intelligence",
        broker=CELERY_BROKER,
        backend=CELERY_RESULT,
    )
    app.conf.update(
        task_serializer="json",
        result_serializer="json",
        accept_content=["json"],
        timezone="Asia/Shanghai",
        enable_utc=True,
        task_track_started=True,
        task_acks_late=True,
        worker_prefetch_multiplier=1,
        task_soft_time_limit=1800,  # 30 分钟软超时
        task_time_limit=3600,       # 60 分钟硬超时
        task_default_queue="target_intelligence",
    )
    HAS_CELERY = True
except ImportError:
    HAS_CELERY = False
    app = None

BASE = Path(__file__).parent.parent


def _run_phase(phase_dir: str, script: str, args: list, output_dir: Path) -> dict:
    """运行单个 phase 脚本"""
    script_path = BASE / phase_dir / "scripts" / script
    cmd = [sys.executable, str(script_path)] + args + ["--output-dir", str(output_dir)]
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(BASE))
    return {
        "returncode": result.returncode,
        "stdout": result.stdout[-2000:] if result.stdout else "",
        "stderr": result.stderr[-2000:] if result.stderr else "",
    }


if HAS_CELERY:
    @app.task(bind=True, name="target_intelligence.run_phase")
    def run_phase_task(self, phase: str, gene: str, disease: str, output_dir: str):
        """运行单个 phase 的异步任务"""
        out = Path(output_dir)
        out.mkdir(parents=True, exist_ok=True)

        phase_map = {
            "phase1": ("phase1-expression", "run_phase1.py", ["--gene", gene, "--cancer-type", disease]),
            "phase2": ("phase2-screening", "run_phase2.py", ["--disease", disease]),
            "phase3": ("phase3-research", "run_phase3.py", ["--gene", gene]),
            "phase4": ("phase4-planning", "run_phase4.py", ["--gene", gene, "--report-dir", str(out)]),
        }

        if phase not in phase_map:
            return {"status": "error", "error": f"Unknown phase: {phase}"}

        phase_dir, script, args = phase_map[phase]

        self.update_state(state="PROGRESS", meta={"phase": phase, "status": "running"})

        result = _run_phase(phase_dir, script, args, out)

        if result["returncode"] == 0:
            return {"status": "completed", "phase": phase, "output_dir": str(out)}
        else:
            return {"status": "failed", "phase": phase, "error": result["stderr"]}

    @app.task(bind=True, name="target_intelligence.run_full_analysis")
    def run_full_analysis(self, gene: str, disease: str, output_dir: str = None):
        """运行完整 4 阶段分析的异步任务"""
        if output_dir is None:
            output_dir = str(BASE / "output" / gene)

        out = Path(output_dir)
        out.mkdir(parents=True, exist_ok=True)

        # 映射疾病名到 TCGA 代码
        TCGA_MAP = {
            "pancreatic cancer": "PAAD", "pancreatic adenocarcinoma": "PAAD",
            "lung adenocarcinoma": "LUAD", "lung cancer": "LUAD",
            "breast cancer": "BRCA", "breast invasive carcinoma": "BRCA",
            "colon cancer": "COAD", "colorectal cancer": "COAD",
            "liver cancer": "LIHC", "hepatocellular carcinoma": "LIHC",
            "prostate cancer": "PRAD", "glioblastoma": "GBM",
            "thyroid cancer": "THCA", "kidney cancer": "KIRC",
            "bladder cancer": "BLCA", "head and neck cancer": "HNSC",
            "gastric cancer": "STAD", "endometrial cancer": "UCEC",
        }
        cancer_type = TCGA_MAP.get(disease.lower(), disease.upper()[:4])

        phases = ["phase1", "phase2", "phase3", "phase4"]
        results = {}

        for i, phase in enumerate(phases):
            self.update_state(
                state="PROGRESS",
                meta={
                    "current_phase": phase,
                    "progress": f"{i+1}/{len(phases)}",
                    "percent": int((i / len(phases)) * 100),
                }
            )

            if phase == "phase1":
                result = _run_phase("phase1-expression", "run_phase1.py",
                                   ["--gene", gene, "--cancer-type", cancer_type], out)
            elif phase == "phase2":
                result = _run_phase("phase2-screening", "run_phase2.py",
                                   ["--disease", disease], out)
            elif phase == "phase3":
                result = _run_phase("phase3-research", "run_phase3.py",
                                   ["--gene", gene], out)
            elif phase == "phase4":
                result = _run_phase("phase4-planning", "run_phase4.py",
                                   ["--gene", gene, "--report-dir", str(out)], out)

            results[phase] = result

            if result["returncode"] != 0:
                return {
                    "status": "failed",
                    "failed_phase": phase,
                    "completed_phases": list(results.keys()),
                    "error": result["stderr"],
                }

        # 生成结果摘要
        summary = {
            "status": "completed",
            "gene": gene,
            "disease": disease,
            "output_dir": str(out),
            "phases_completed": list(results.keys()),
            "completed_at": datetime.now().isoformat(),
        }

        # 保存摘要
        summary_path = out / "task_summary.json"
        with open(summary_path, "w", encoding="utf-8") as f:
            json.dump(summary, f, indent=2, ensure_ascii=False)

        return summary


    @app.task(name="target_intelligence.get_status")
    def get_status(task_id: str):
        """查询任务状态"""
        from celery.result import AsyncResult
        result = AsyncResult(task_id, app=app)
        return {
            "task_id": task_id,
            "status": result.status,
            "result": result.result if result.ready() else None,
            "info": result.info if hasattr(result, 'info') else None,
        }


# 无 Celery 时的同步降级
def run_full_analysis_sync(gene: str, disease: str, output_dir: str = None):
    """无 Celery 时的同步执行降级"""
    if output_dir is None:
        output_dir = str(BASE / "output" / gene)

    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    TCGA_MAP = {
        "pancreatic cancer": "PAAD", "pancreatic adenocarcinoma": "PAAD",
        "lung adenocarcinoma": "LUAD", "lung cancer": "LUAD",
        "breast cancer": "BRCA",
    }
    cancer_type = TCGA_MAP.get(disease.lower(), disease.upper()[:4])

    phases = [
        ("phase1-expression", "run_phase1.py", ["--gene", gene, "--cancer-type", cancer_type]),
        ("phase2-screening", "run_phase2.py", ["--disease", disease]),
        ("phase3-research", "run_phase3.py", ["--gene", gene]),
        ("phase4-planning", "run_phase4.py", ["--gene", gene, "--report-dir", str(out)]),
    ]

    results = {}
    for phase_dir, script, args in phases:
        print(f"\n{'='*60}")
        print(f"Running: {script}")
        print(f"{'='*60}")
        result = _run_phase(phase_dir, script, args, out)
        phase_name = phase_dir.split("-")[0]
        results[phase_name] = result
        if result["returncode"] != 0:
            print(f"[FAIL] {script}: {result['stderr'][:500]}")
            break
        else:
            print(f"[OK] {script}")

    return results
