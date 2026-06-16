#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def save(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def default_state(task_id: str = "", level: str = "M") -> dict:
    return {
        "task_id": task_id,
        "level": level,
        "phase": "explore",
        "artifacts_dir": "",
        "runtime_contract": "",
        "reality_check": "",
        "resource_cleanup": "",
        "explored_files": [],
        "file_count": 0,
        "main_contradiction": "",
        "completed_gates": [],
        "open_tasks": [],
        "files_modified": [],
        "updated_at": now(),
    }


def init(args: list[str]) -> int:
    state_path, task_id, level, artifacts_dir = Path(args[0]), args[1], args[2], args[3]
    data = default_state(task_id, level)
    data["artifacts_dir"] = artifacts_dir
    data["runtime_contract"] = str(Path(artifacts_dir) / "runtime.md")
    data["reality_check"] = str(Path(artifacts_dir) / "reality-check.md")
    data["resource_cleanup"] = str(Path(artifacts_dir) / "resource-cleanup.md")
    save(state_path, data)
    return 0


def explore(args: list[str]) -> int:
    state_path, detail_path, contradiction = Path(args[0]), Path(args[1]), args[2]
    files = args[3:]
    data = load(state_path) or default_state("ad-hoc-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"), "M")
    data.update(
        {
            "phase": "explore",
            "explored_files": files,
            "file_count": len(files),
            "main_contradiction": contradiction,
            "updated_at": now(),
        }
    )
    save(state_path, data)
    save(
        detail_path,
        {
            "updated_at": data["updated_at"],
            "files": files,
            "file_count": len(files),
            "main_contradiction": contradiction,
            "skills_checked": True,
        },
    )
    return 0


def plan(args: list[str]) -> int:
    state_path, task_id, level, artifacts_dir = Path(args[0]), args[1], args[2], args[3]
    data = load(state_path) or default_state(task_id, level)
    data.update(
        {
            "task_id": task_id,
            "level": level,
            "phase": "plan",
            "artifacts_dir": artifacts_dir,
            "runtime_contract": str(Path(artifacts_dir) / "runtime.md"),
            "reality_check": str(Path(artifacts_dir) / "reality-check.md"),
            "resource_cleanup": str(Path(artifacts_dir) / "resource-cleanup.md"),
            "updated_at": now(),
        }
    )
    save(state_path, data)
    return 0


def checkpoint(args: list[str]) -> int:
    state_path, root, phase = Path(args[0]), Path(args[1]), args[2]
    data = load(state_path) or default_state("ad-hoc-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"), "M")
    try:
        result = subprocess.run(
            ["git", "status", "--short"],
            cwd=root,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        files = []
        for line in result.stdout.splitlines():
            if len(line) < 4:
                continue
            path = line[3:].strip()
            if " -> " in path:
                path = path.split(" -> ", 1)[1]
            if path:
                files.append(path)
    except Exception:
        files = []
    data["phase"] = phase
    data["files_modified"] = files
    data["updated_at"] = now()
    data.setdefault("completed_gates", [])
    data.setdefault("open_tasks", [])
    save(state_path, data)
    return 0


def get(args: list[str]) -> int:
    data = load(Path(args[0]))
    value = data.get(args[1], args[2] if len(args) > 2 else "")
    if isinstance(value, list):
        print(", ".join(str(v) for v in value))
    else:
        print(value)
    return 0


def length(args: list[str]) -> int:
    data = load(Path(args[0]))
    value = data.get(args[1], [])
    if isinstance(value, list):
        print(len(value))
    else:
        print(int(value or 0))
    return 0


def add_gates(args: list[str]) -> int:
    state_path = Path(args[0])
    data = load(state_path)
    existing = data.get("completed_gates", [])
    if not isinstance(existing, list):
        existing = []
    data["completed_gates"] = sorted(set(existing + args[1:]))
    data["phase"] = "verify"
    data["updated_at"] = now()
    save(state_path, data)
    return 0


commands = {
    "init": init,
    "explore": explore,
    "plan": plan,
    "checkpoint": checkpoint,
    "get": get,
    "len": length,
    "add-gates": add_gates,
}

if len(sys.argv) < 2 or sys.argv[1] not in commands:
    print("usage: workflow_state.py <command> ...", file=sys.stderr)
    raise SystemExit(2)

raise SystemExit(commands[sys.argv[1]](sys.argv[2:]))
