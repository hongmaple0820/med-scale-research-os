from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import threading
import uuid
from datetime import datetime
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

from ..output.delivery_packager import audit_delivery_package
from .deliverables import (
    build_comparison_report,
    build_report_bundle,
    discover_target_profiles,
    list_researcher_deliverables,
    summarize_json_preview,
)
from .status_tracker import LiveStatusTracker, build_idle_status


def build_content_disposition(filename: str, inline: bool = False) -> str:
    disposition = "inline" if inline else "attachment"
    ascii_filename = filename.encode("ascii", "ignore").decode("ascii").strip()
    ascii_filename = ascii_filename.replace("\\", "_").replace('"', "")
    if not ascii_filename:
        ascii_filename = "download"
    return (
        f"{disposition}; filename=\"{ascii_filename}\"; "
        f"filename*=UTF-8''{quote(filename)}"
    )


class DashboardState:
    def __init__(self, base_dir: Path):
        self.base_dir = base_dir
        self.output_dir = base_dir / "output"
        self.runtime_dir = self.output_dir / "dashboard_runtime"
        self.runtime_dir.mkdir(parents=True, exist_ok=True)
        self.status_file = self.runtime_dir / "live_status.json"
        self.tracker = LiveStatusTracker(self.status_file)
        self._process: subprocess.Popen[str] | None = None
        self._lock = threading.Lock()

    def load_status(self) -> dict:
        if not self.status_file.exists():
            return self._attach_medical_research_os(build_idle_status())
        try:
            status = json.loads(self.status_file.read_text(encoding="utf-8"))
            status = self._attach_delivery_readiness(status)
            status = self._attach_stage_completion(status)
            status = self._attach_status_label(status)
            status = self._attach_medical_research_os(status)
            return status
        except Exception as exc:
            return self._attach_medical_research_os({
                **build_idle_status(),
                "status": "failed",
                "logs": [{"timestamp": "", "level": "error", "message": f"Status file read failed: {exc}"}],
            })

    def _attach_delivery_readiness(self, status: dict) -> dict:
        """Attach researcher-facing delivery readiness fields from the manifest."""
        if not isinstance(status, dict):
            return status
        artifacts = status.get("artifacts") or {}
        manifest_path = self._resolve_artifact_path(artifacts.get("delivery_manifest"))
        manifest = self._read_json(manifest_path) if manifest_path else {}
        if not manifest:
            return status

        summary = status.setdefault("summary", {})
        if not isinstance(summary, dict):
            summary = {}
            status["summary"] = summary
        package_path = self._resolve_artifact_path(
            artifacts.get("delivery_package") or summary.get("delivery_package")
        )
        package_audit = self._resolve_package_audit(summary.get("package_audit"), package_path, manifest)
        if package_audit:
            summary["package_audit"] = package_audit
        quality_gate = self._dict_value(summary.get("quality_gate")) or self._dict_value(manifest.get("quality_gate"))
        fact_check = self._dict_value(summary.get("fact_check")) or self._dict_value(manifest.get("fact_check"))
        if quality_gate:
            summary["quality_gate"] = quality_gate
        if fact_check:
            summary["fact_check"] = fact_check
        memory_seed = self._memory_seed_status(manifest_path)
        learning_candidate = self._learning_candidate_status(manifest_path)
        summary["delivery_readiness"] = {
            "manifest_path": str(manifest_path),
            "quality_findings": manifest.get("quality_findings") or [],
            "human_review_todo": manifest.get("human_review_todo") or [],
            "literature_evidence": self._literature_evidence(manifest),
            "review_examples": self._literature_review_examples(manifest),
            "review_files": self._literature_review_files(manifest),
            "package_audit": package_audit,
            "memory_seed": memory_seed,
            "learning_candidate": learning_candidate,
            "researcher_cards": self._researcher_readiness_cards(
                quality_gate,
                fact_check,
                manifest.get("quality_findings") or [],
                package_audit,
                memory_seed,
                learning_candidate,
            ),
            "disclaimer": manifest.get("disclaimer"),
        }
        return status

    def _attach_stage_completion(self, status: dict) -> dict:
        if not isinstance(status, dict):
            return status

        target = str(status.get("target") or "").strip()
        disease = str(status.get("disease") or "").strip()
        bundle = build_report_bundle(
            self.output_dir,
            current_target=target or None,
            current_disease=disease or None,
        )
        sections = {
            item.get("id"): item
            for item in bundle.get("sections") or []
            if isinstance(item, dict) and item.get("id")
        }
        profile = self._matching_profile(target, disease)

        default_stages = build_idle_status()["stages"]
        stages = status.get("stages")
        if not isinstance(stages, dict):
            stages = default_stages
            status["stages"] = stages

        for stage_key in ("stage1", "stage2", "stage3", "stage4"):
            stage_state = stages.setdefault(stage_key, default_stages[stage_key].copy())
            section = sections.get(stage_key) or {}
            artifact_path = section.get("path")
            if artifact_path and stage_state.get("status") != "failed":
                stage_state["status"] = "completed"
                stage_state["finished_at"] = stage_state.get("finished_at") or self._mtime_iso(artifact_path)
            metrics = ((profile.get("metrics") or {}).get(stage_key) or {}) if profile else {}
            if metrics:
                merged_metrics = dict(stage_state.get("metrics") or {})
                for key, value in metrics.items():
                    if value not in (None, "", [], {}):
                        merged_metrics[key] = value
                stage_state["metrics"] = merged_metrics

        return status

    def _attach_status_label(self, status: dict) -> dict:
        if not isinstance(status, dict):
            return status
        if status.get("status") == "completed" and not status.get("current_stage_label"):
            artifacts = status.get("artifacts") or {}
            if artifacts.get("delivery_package"):
                status["current_stage_label"] = "交付包已就绪"
            else:
                completed = sum(
                    1
                    for stage in (status.get("stages") or {}).values()
                    if isinstance(stage, dict) and stage.get("status") == "completed"
                )
                if completed == 4:
                    status["current_stage_label"] = "研究流程已完成"
        return status

    def _matching_profile(self, target: str, disease: str) -> dict | None:
        if not target:
            return None
        for profile in discover_target_profiles(self.output_dir):
            if str(profile.get("target") or "").strip().lower() != target.lower():
                continue
            if disease and str(profile.get("disease") or "").strip().lower() != disease.lower():
                continue
            return profile
        return None

    def _resolve_package_audit(
        self,
        inline_value: object,
        package_path: Path | None,
        manifest: dict[str, object],
    ) -> dict:
        if isinstance(inline_value, dict) and inline_value:
            return inline_value
        if not package_path or not manifest:
            return {}
        return audit_delivery_package(package_path, manifest)

    @staticmethod
    def _mtime_iso(path: str | Path) -> str | None:
        try:
            return datetime.fromtimestamp(Path(path).stat().st_mtime).isoformat()
        except Exception:
            return None

    def _resolve_artifact_path(self, raw_path: str | None) -> Path | None:
        if not raw_path:
            return None
        raw = Path(raw_path)
        candidates = []
        if raw.is_absolute():
            candidates.append(raw)
        else:
            candidates.extend([
                self.base_dir / raw,
                self.base_dir.parent / raw,
                self.output_dir / raw,
            ])
        for candidate in candidates:
            try:
                resolved = candidate.resolve()
            except Exception:
                continue
            if resolved.exists():
                return resolved
        return candidates[0].resolve() if candidates else None

    @staticmethod
    def _read_json(path: Path | None) -> dict:
        if not path or not path.exists():
            return {}
        try:
            payload = json.loads(path.read_text(encoding="utf-8-sig"))
            return payload if isinstance(payload, dict) else {}
        except Exception:
            return {}

    @staticmethod
    def _dict_value(value: object) -> dict:
        return value if isinstance(value, dict) else {}

    @staticmethod
    def _bool_state(value: object) -> str:
        if value is True:
            return "PASS"
        if value is False:
            return "FAIL"
        return "UNKNOWN"

    @staticmethod
    def _int_value(value: object, default: int = 0) -> int:
        try:
            return int(value or 0)
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _list_count(value: object) -> int:
        return len(value) if isinstance(value, list) else 0

    @staticmethod
    def _card(
        card_id: str,
        title: str,
        state: str,
        status_label: str,
        value: str,
        summary: str,
        details: list[str],
        next_action: str,
    ) -> dict:
        return {
            "id": card_id,
            "title": title,
            "state": state,
            "status_label": status_label,
            "value": value,
            "summary": summary,
            "details": [item for item in details if item],
            "next_action": next_action,
        }

    def _quality_researcher_card(self, quality: dict, findings: list[object]) -> dict:
        passed = quality.get("passed") if quality else None
        errors = self._int_value(quality.get("errors") if quality else 0)
        warnings = self._int_value(quality.get("warnings") if quality else 0)
        score = quality.get("score") if quality else None
        grade = str(quality.get("grade") or "").strip() if quality else ""
        verdict = self._bool_state(passed)
        value_parts = [verdict]
        if grade:
            value_parts.append(grade)
        if score not in (None, ""):
            value_parts.append(str(score))

        if passed is False:
            state = "fail"
            status_label = "需修复"
            summary = "论文质量门禁未通过，不建议进入外部研究者审阅。"
            next_action = "先修复质量错误和关键 findings，再重新生成交付物。"
        elif passed is True and (warnings > 0 or findings):
            state = "warning"
            status_label = "通过但需复核"
            summary = "核心质量门禁通过，但仍有警告或审阅提醒需要人工确认。"
            next_action = "投递前逐项复核 warnings 与质量 findings。"
        elif passed is True:
            state = "pass"
            status_label = "可审阅"
            summary = "结构、边界声明、图表和元数据质量门禁已通过。"
            next_action = "进入医学专家和作者团队复核。"
        else:
            state = "pending"
            status_label = "等待报告"
            summary = "尚未读取到论文质量门禁报告。"
            next_action = "生成或打包论文后刷新质量状态。"

        finding_details: list[str] = []
        for item in findings[:3]:
            if not isinstance(item, dict):
                continue
            finding_details.append(
                f"{item.get('severity') or 'finding'}: {item.get('id') or 'quality'}"
            )

        return self._card(
            "quality",
            "论文质量",
            state,
            status_label,
            " ".join(value_parts),
            summary,
            [
                f"score={score if score not in (None, '') else '-'}; grade={grade or '-'}",
                f"errors={errors}; warnings={warnings}; findings={len(findings)}",
                *finding_details,
            ],
            next_action,
        )

    def _fact_check_researcher_card(self, fact: dict) -> dict:
        passed = fact.get("passed") if fact else None
        errors = self._int_value(fact.get("errors") if fact else 0)
        warnings = self._int_value(fact.get("warnings") if fact else 0)
        score = fact.get("score") if fact else None
        unverified = self._list_count(fact.get("unverified_claims") if fact else None)
        failed_claims = self._list_count(fact.get("failed_claims") if fact else None)
        verdict = self._bool_state(passed)

        if passed is False:
            state = "fail"
            status_label = "事实阻断"
            summary = "事实核查发现硬错误，当前稿件不应发送给研究者。"
            next_action = "修复 PMID、数字、图表引用或医学边界错误后重跑核查。"
        elif passed is True and (warnings > 0 or unverified > 0):
            state = "warning"
            status_label = "需人工确认"
            summary = "事实核查通过，但仍有未验证或警告项需要专家确认。"
            next_action = "人工确认未验证 claims，并补充可追溯证据。"
        elif passed is True:
            state = "pass"
            status_label = "可审阅"
            summary = "关键医学事实、PMID、数字和图表引用通过自动核查。"
            next_action = "进入人工医学事实复核。"
        else:
            state = "pending"
            status_label = "等待核查"
            summary = "尚未读取到事实核查报告。"
            next_action = "生成事实核查报告后再判断交付 readiness。"

        return self._card(
            "fact_check",
            "事实核查",
            state,
            status_label,
            f"{verdict} {score if score not in (None, '') else '-'}",
            summary,
            [
                f"errors={errors}; warnings={warnings}",
                f"unverified_claims={unverified}; failed_claims={failed_claims}",
            ],
            next_action,
        )

    def _package_audit_researcher_card(self, package_audit: dict) -> dict:
        passed = package_audit.get("passed") if package_audit else None
        errors = self._int_value(package_audit.get("errors") if package_audit else 0)
        warnings = self._int_value(package_audit.get("warnings") if package_audit else 0)
        broken_images = self._list_count(package_audit.get("broken_image_refs") if package_audit else None)
        broken_links = self._list_count(package_audit.get("broken_markdown_refs") if package_audit else None)
        checked = self._int_value(package_audit.get("files_checked") if package_audit else 0)
        entries = self._int_value(package_audit.get("entry_count") if package_audit else 0)

        if passed is False:
            state = "fail"
            status_label = "ZIP 不可交付"
            value = "FAIL"
            summary = "交付 ZIP 已生成但归档自检失败，可能存在断链或缺失文件。"
            next_action = "修复断链、manifest 或 README 后重新打包。"
        elif passed is True:
            state = "pass"
            status_label = "ZIP 可交付"
            value = "PASS"
            summary = "ZIP 文件、README、manifest 和本地图表引用通过自检。"
            next_action = "可下载交给研究者审阅，但仍需人工医学复核。"
        elif entries or checked:
            state = "warning"
            status_label = "自检未定"
            value = "REVIEW"
            summary = "已有归档检查信号，但未得到明确通过结果。"
            next_action = "复核 package audit 输出并重新打包确认。"
        else:
            state = "pending"
            status_label = "等待打包"
            value = "PENDING"
            summary = "尚未读取到当前交付 ZIP 的归档自检结果。"
            next_action = "生成交付 ZIP 后刷新自检状态。"

        return self._card(
            "package_audit",
            "交付 ZIP",
            state,
            status_label,
            value,
            summary,
            [
                f"entries={entries}; files_checked={checked}",
                f"README={'ready' if package_audit.get('readme_present') else 'missing'}; manifest={'ready' if package_audit.get('manifest_present') else 'missing'}",
                f"errors={errors}; warnings={warnings}; broken_images={broken_images}; broken_links={broken_links}",
            ],
            next_action,
        )

    def _memory_seed_researcher_card(self, memory_seed: dict) -> dict:
        import_ok = memory_seed.get("import_ok")
        warnings = self._string_list(memory_seed.get("warnings"))
        missing_roles = self._string_list(memory_seed.get("missing_roles"))
        record_ready = bool(memory_seed.get("record_ready"))
        summary_ready = bool(memory_seed.get("summary_ready"))
        provider = memory_seed.get("provider") or "memory"

        if import_ok is False:
            state = "fail"
            status_label = "导入失败"
            value = f"{provider} FAILED"
            summary = "已生成 memory seed 记录，但导入记忆供应商失败。"
            next_action = "检查 provider 配置和导入日志后重新播种。"
        elif import_ok is True and not warnings and not missing_roles:
            state = "pass"
            status_label = "已播种"
            value = f"{provider} READY"
            summary = "医学交付摘要已写入记忆供应商，可支持后续 recall。"
            next_action = "后续相关研究可复用该交付记忆。"
        elif record_ready or summary_ready:
            state = "warning"
            status_label = "待复核"
            value = f"{provider} PARTIAL"
            summary = "memory seed 文件已生成，但仍需确认导入、缺失角色或警告。"
            next_action = "补齐缺失角色并复核播种摘要。"
        else:
            state = "pending"
            status_label = "未播种"
            value = "PENDING"
            summary = "尚未为当前医学交付生成 memory seed。"
            next_action = "运行 memory seed 步骤沉淀交付摘要。"

        return self._card(
            "memory_seed",
            "记忆播种",
            state,
            status_label,
            value,
            summary,
            [
                f"record={'ready' if record_ready else 'missing'}; summary={'ready' if summary_ready else 'missing'}",
                f"sources={memory_seed.get('source_file_count') or 0}; staged={memory_seed.get('staged_file_count') or 0}",
                f"missing_roles={', '.join(missing_roles) if missing_roles else 'none'}",
                *[f"warning={item}" for item in warnings[:3]],
            ],
            next_action,
        )

    def _learning_candidate_researcher_card(self, learning_candidate: dict) -> dict:
        brain_ingest_ok = learning_candidate.get("brain_ingest_ok")
        promotable = bool(learning_candidate.get("promotable"))
        record_ready = bool(learning_candidate.get("record_ready"))
        summary_ready = bool(learning_candidate.get("summary_ready"))
        recommended_action = learning_candidate.get("recommended_action") or "pending"
        warnings = self._string_list(learning_candidate.get("warnings"))
        review_status = str(learning_candidate.get("review_status") or "pending").strip().lower()
        review_ready = bool(learning_candidate.get("review_ready"))

        if brain_ingest_ok is False:
            state = "fail"
            status_label = "沉淀失败"
            value = "FAILED"
            summary = "learning candidate 生成后导入 Memory Brain 失败。"
            next_action = "修复导入失败或证据缺口后重新生成候选。"
        elif review_status == "approved":
            state = "pass"
            status_label = "已批准"
            value = "APPROVED"
            summary = "learning candidate 已通过 Memory Brain 人工审核，可作为长期医学研究记忆复用。"
            next_action = "在后续医学研究中通过 Memory Brain recall 复用，并定期复核 stale 风险。"
        elif review_status == "rejected":
            state = "fail"
            status_label = "已拒绝"
            value = "REJECTED"
            summary = "learning candidate 已被人工拒绝，不应进入长期知识或后续 recall。"
            next_action = "依据拒绝原因补证据或保持排除，并重新生成候选后再审。"
        elif review_status == "stale":
            state = "warning"
            status_label = "证据过期"
            value = "STALE"
            summary = "learning candidate 被标记为 stale，需要更新证据后再进入长期复用。"
            next_action = "补跑 PubMed/OpenAlex、事实核查和统计审查后重新 restore 或 approve。"
        elif review_status == "restored":
            state = "warning"
            status_label = "已恢复复审"
            value = "RESTORED"
            summary = "learning candidate 已从 rejected/stale 恢复，等待下一轮人工批准。"
            next_action = "复核恢复原因、证据更新和质量门禁，再执行 approve/reject/stale。"
        elif promotable:
            state = "pass"
            status_label = "可复审"
            value = "READY"
            summary = "本次医学交付已沉淀为可审阅的学习候选。"
            next_action = "交给知识库或 Memory Brain 流程做人工复审。"
        elif record_ready or summary_ready:
            state = "warning"
            status_label = "需补证据"
            value = "REVIEW"
            summary = "learning candidate 已生成，但还不适合直接提升为长期知识。"
            next_action = "补齐证据、处理质量问题，再进入复审。"
        else:
            state = "pending"
            status_label = "未生成"
            value = "PENDING"
            summary = "尚未为当前医学交付生成学习候选。"
            next_action = "在质量和事实状态稳定后生成 learning candidate。"

        card = self._card(
            "learning_candidate",
            "学习沉淀",
            state,
            status_label,
            value,
            summary,
            [
                f"candidate={learning_candidate.get('candidate_id') or 'missing'}",
                f"record={'ready' if record_ready else 'missing'}; summary={'ready' if summary_ready else 'missing'}",
                f"recommended={recommended_action}",
                f"brain_node={learning_candidate.get('brain_node_id') or 'none'}",
                f"review={'ready' if review_ready else 'pending'}; status={review_status}",
                f"reviewer={learning_candidate.get('reviewer') or 'none'}",
                *[f"warning={item}" for item in warnings[:3]],
            ],
            next_action,
        )
        card["review_status"] = review_status
        card["review_ready"] = review_ready
        card["reviewer"] = learning_candidate.get("reviewer")
        card["review_updated_at"] = learning_candidate.get("review_updated_at")
        card["candidate_id"] = learning_candidate.get("candidate_id")
        card["review_actions"] = ["approve", "reject", "stale", "restore"] if learning_candidate.get("candidate_id") else []
        return card

    def _researcher_readiness_cards(
        self,
        quality: dict,
        fact: dict,
        findings: list[object],
        package_audit: dict,
        memory_seed: dict,
        learning_candidate: dict,
    ) -> list[dict]:
        return [
            self._quality_researcher_card(quality, findings),
            self._fact_check_researcher_card(fact),
            self._package_audit_researcher_card(package_audit),
            self._memory_seed_researcher_card(memory_seed),
            self._learning_candidate_researcher_card(learning_candidate),
        ]

    def _attach_medical_research_os(self, status: dict) -> dict:
        """Attach the standalone MedSCALE medical research operating layer."""
        if not isinstance(status, dict):
            return status
        summary = status.setdefault("summary", {})
        if not isinstance(summary, dict):
            summary = {}
            status["summary"] = summary

        readiness = self._dict_value(summary.get("delivery_readiness"))
        researcher_cards = readiness.get("researcher_cards") if readiness else []
        if not isinstance(researcher_cards, list):
            researcher_cards = []

        runtime_readiness = self._medical_runtime_readiness()
        summary["medical_runtime_readiness"] = runtime_readiness
        token_cost = self._token_cost_report()

        signals = self._medical_os_signals(readiness, researcher_cards)
        score = self._medical_os_score(signals)
        status_label = self._medical_os_status(score, signals)
        review_escalated = any(signal["state"] in {"fail", "warning"} for signal in signals)
        missing_count = sum(1 for signal in signals if signal["state"] == "pending")
        total_token_budget = 24000
        assigned_tokens = 18000

        summary["medical_research_os"] = {
            "product": {
                "name": "MedSCALE Research OS",
                "cn_name": "MedSCALE 医研操作系统",
                "tagline": "把医学研究 Agent 流程变成可审阅、可交付、可沉淀的证据操作系统。",
                "source_upgrade": "MedSCALE native workflow",
            },
            "operating_model": {
                "strategy": "medical-agent-collaboration-v1",
                "mode": "review-escalated" if review_escalated else "multi-agent",
                "status": status_label,
                "readiness_score": score,
                "ready_signals": sum(1 for signal in signals if signal["state"] == "pass"),
                "warning_signals": sum(1 for signal in signals if signal["state"] == "warning"),
                "missing_signals": missing_count,
                "review_required": True,
                "human_review_todo": readiness.get("human_review_todo") or [],
            },
            "loop_readiness": {
                "score": score,
                "signals": signals,
                "recommendations": self._medical_os_recommendations(signals),
            },
            "research_team": {
                "roles": self._medical_os_roles(signals),
                "handoffs": self._medical_os_handoffs(),
                "review_gates": self._medical_os_review_gates(signals),
                "budget": {
                    "total_tokens": total_token_budget,
                    "assigned_tokens": assigned_tokens,
                    "reserve_tokens": total_token_budget - assigned_tokens,
                    "reserve_reason": "为人工复核、事实争议和补充检索保留上下文预算。",
                },
            },
            "prompt_studio": {
                "templates": self._medical_os_prompt_templates(),
                "actions": ["copy_prompt", "download_prompt", "export_json"],
                "safe_preview": True,
            },
            "memory_strategy": self._medical_os_memory_strategy(readiness),
            "token_cost": token_cost,
            "runtime_readiness": runtime_readiness,
            "next_migrations": [
                "把医学协作计划导出为独立 JSON，供 Dashboard、CLI 和后续 MCP 直接复用。",
                "把 Prompt Studio 模板提升为 /api/prompts 医学分区，支持复制、下载和多角色 handoff。",
                "新增 native medical doctor，检查 gbrain、PubMed/OpenAlex、包审计和图表引用。",
                "持续记录文献评审、Agent review、fact check 和 memory settlement 的 token/cost，并在交付前复盘高成本环节。",
                "把 Memory Brain 候选审核做成 approve/reject/stale/restore 的可审阅流程。",
            ],
        }
        return status

    def _workspace_root(self) -> Path:
        candidates = [self.base_dir, self.base_dir.parent]
        for candidate in candidates:
            if (candidate / ".scale").exists():
                return candidate
        for candidate in candidates:
            if (candidate / "package.json").exists() and (candidate / "target-research-platform").exists():
                return candidate
        return self.base_dir

    def _read_workspace_json(self, root: Path, relative_path: str) -> dict:
        return self._read_json(root / relative_path)

    def _model_usage_path(self) -> Path:
        return self._workspace_root() / ".scale" / "model-usage" / "usage.jsonl"

    @staticmethod
    def _number_value(value: object, default: float = 0) -> float:
        try:
            parsed = float(value)
            return parsed if parsed >= 0 else default
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _usage_medical_lane(record: dict) -> str:
        metadata = record.get("metadata") if isinstance(record.get("metadata"), dict) else {}
        explicit = str(
            metadata.get("medical_lane")
            or metadata.get("phase")
            or metadata.get("gate")
            or ""
        ).lower()
        haystack = " ".join([
            explicit,
            str(record.get("taskId") or ""),
            str(record.get("sessionId") or ""),
            str(record.get("model") or ""),
        ]).lower()
        if any(token in haystack for token in ("literature", "pubmed", "openalex", "文献", "检索")):
            return "literature"
        if any(token in haystack for token in ("fact", "claim", "事实", "核查")):
            return "fact_check"
        if any(token in haystack for token in ("package", "audit", "delivery", "zip", "交付", "审计")):
            return "package_audit"
        if any(token in haystack for token in ("memory", "gbrain", "learning", "candidate", "记忆", "沉淀")):
            return "memory"
        if any(token in haystack for token in ("agent", "review", "handoff", "peer", "评审", "协作")):
            return "agent_review"
        return "workflow"

    @staticmethod
    def _usage_lane_label(lane: str) -> str:
        return {
            "literature": "Literature review",
            "fact_check": "Medical fact check",
            "package_audit": "Package audit",
            "memory": "Memory settlement",
            "agent_review": "Agent review",
            "workflow": "Workflow",
        }.get(lane, lane)

    def _model_usage_records(self) -> list[dict]:
        usage_path = self._model_usage_path()
        if not usage_path.exists():
            return []
        records: list[dict] = []
        for line in usage_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(record, dict):
                records.append(record)
        return records

    def _token_cost_report(self) -> dict:
        usage_path = self._model_usage_path()
        records = self._model_usage_records()
        summary = {
            "total_records": len(records),
            "total_input_tokens": 0,
            "total_output_tokens": 0,
            "total_tokens": 0,
            "cache_savings_tokens": 0,
            "estimated_cost_usd": None,
        }
        lanes: dict[str, dict] = {}
        estimated_cost: float | None = None
        for record in records:
            input_tokens = int(self._number_value(record.get("inputTokens")))
            output_tokens = int(self._number_value(record.get("outputTokens")))
            total_tokens = int(self._number_value(record.get("totalTokens"), input_tokens + output_tokens))
            cache_savings = int(self._number_value(record.get("cacheSavingsTokens")))
            cost_value = record.get("estimatedCostUsd")
            cost = self._number_value(cost_value) if cost_value is not None else None
            summary["total_input_tokens"] += input_tokens
            summary["total_output_tokens"] += output_tokens
            summary["total_tokens"] += total_tokens
            summary["cache_savings_tokens"] += cache_savings
            if cost is not None:
                estimated_cost = (estimated_cost or 0) + cost
            lane_key = self._usage_medical_lane(record)
            lane = lanes.setdefault(lane_key, {
                "key": lane_key,
                "label": self._usage_lane_label(lane_key),
                "records": 0,
                "total_tokens": 0,
                "cache_savings_tokens": 0,
                "estimated_cost_usd": None,
            })
            lane["records"] += 1
            lane["total_tokens"] += total_tokens
            lane["cache_savings_tokens"] += cache_savings
            if cost is not None:
                lane["estimated_cost_usd"] = round((lane["estimated_cost_usd"] or 0) + cost, 6)
        if estimated_cost is not None:
            summary["estimated_cost_usd"] = round(estimated_cost, 6)
        by_lane = sorted(lanes.values(), key=lambda item: (-item["total_tokens"], item["key"]))
        recent_records = sorted(records, key=lambda item: str(item.get("timestamp") or ""), reverse=True)[:10]
        return {
            "schema": "medscale.token_cost.v1",
            "status": "ready" if records else "pending",
            "usage_path": str(usage_path),
            "summary": summary,
            "by_medical_lane": by_lane,
            "recent_records": [
                {
                    "timestamp": record.get("timestamp"),
                    "provider": record.get("provider"),
                    "model": record.get("model"),
                    "task_id": record.get("taskId"),
                    "total_tokens": record.get("totalTokens"),
                    "estimated_cost_usd": record.get("estimatedCostUsd"),
                    "medical_lane": self._usage_medical_lane(record),
                }
                for record in recent_records
            ],
            "recommendations": [
                "Review high-token medical lanes before expert handoff and package delivery.",
            ] if records else [
                "Record token/cost usage after literature review, fact check, package audit, agent review, and memory settlement.",
            ],
        }

    @staticmethod
    def _command_probe(command: str) -> dict:
        binary = command.split()[0]
        path = shutil.which(binary)
        return {
            "command": command,
            "binary": binary,
            "available": bool(path),
            "path": path,
        }

    @staticmethod
    def _runtime_card(
        card_id: str,
        title: str,
        state: str,
        status_label: str,
        summary: str,
        details: list[str],
        next_action: str,
        required: bool,
    ) -> dict:
        return {
            "id": card_id,
            "title": title,
            "state": state,
            "status_label": status_label,
            "summary": summary,
            "details": details,
            "next_action": next_action,
            "required": required,
        }

    def _medical_runtime_readiness(self) -> dict:
        root = self._workspace_root()
        cards = [
            self._runtime_memory_card(root),
            self._runtime_code_intelligence_card(root),
            self._runtime_cli_card(root),
            self._runtime_skills_card(root),
            self._runtime_mcp_card(root),
            self._runtime_token_cost_card(root),
            self._runtime_medical_workflow_card(root),
        ]
        required_missing = [
            detail
            for card in cards
            if card["required"] and card["state"] == "fail"
            for detail in card["details"]
        ]
        warning_count = sum(1 for card in cards if card["state"] == "warning")
        fail_count = sum(1 for card in cards if card["state"] == "fail")
        status = "ready"
        if required_missing:
            status = "blocked"
        elif warning_count or fail_count:
            status = "degraded"
        return {
            "schema": "medscale.runtime_readiness.v1",
            "status": status,
            "score": self._runtime_readiness_score(cards),
            "workspace_root": str(root),
            "required_missing": required_missing,
            "warning_count": warning_count,
            "fail_count": fail_count,
            "cards": cards,
            "recommendations": self._runtime_recommendations(cards),
        }

    def _runtime_memory_card(self, root: Path) -> dict:
        config = self._read_workspace_json(root, ".scale/memory-providers.json")
        providers = config.get("providers") if isinstance(config.get("providers"), list) else []
        provider_by_id = {
            str(provider.get("id")): provider
            for provider in providers
            if isinstance(provider, dict) and provider.get("id")
        }
        gbrain = self._dict_value(provider_by_id.get("gbrain"))
        scale_local = self._dict_value(provider_by_id.get("scale-local"))
        agentmemory = self._dict_value(provider_by_id.get("agentmemory"))
        gbrain_probe = self._command_probe("gbrain")
        routing = self._dict_value(config.get("routing"))
        default_order = routing.get("defaultOrder") if isinstance(routing.get("defaultOrder"), list) else []
        details = [
            f"routing={routing.get('mode') or 'missing'}; order={','.join(default_order) if default_order else 'missing'}",
            f"gbrain={'enabled' if gbrain.get('enabled') else 'disabled'}; command={'found' if gbrain_probe['available'] else 'missing'}; write={gbrain.get('writeMode') or 'unknown'}",
            f"scale-local={'enabled' if scale_local.get('enabled') else 'disabled'}; write={scale_local.get('writeMode') or 'unknown'}",
            f"agentmemory={'enabled' if agentmemory.get('enabled') else 'disabled'}",
        ]
        if not config:
            return self._runtime_card(
                "third_party_memory",
                "Third-party memory",
                "warning",
                "CONFIG MISSING",
                "External memory routing is not configured; the native medical workflow can still run.",
                details,
                "Add a medical memory provider config when recall and memory review are needed.",
                False,
            )
        if not gbrain.get("enabled") or not gbrain_probe["available"]:
            return self._runtime_card(
                "third_party_memory",
                "Third-party memory",
                "warning",
                "GBRAIN OPTIONAL",
                "gbrain is unavailable, so recall and memory review will stay local or pending.",
                details,
                "Install or enable gbrain only if this study needs cross-session memory recall.",
                False,
            )
        return self._runtime_card(
            "third_party_memory",
            "Third-party memory",
            "pass",
            "GBRAIN READY",
            "External-first memory routing is available for governed research recall.",
            details,
            "Next: expose provider recall and Memory Brain review transitions.",
            False,
        )

    def _runtime_code_intelligence_card(self, root: Path) -> dict:
        config = self._read_workspace_json(root, ".scale/code-intelligence.json")
        codegraph_probe = self._command_probe("codegraph")
        graphify_probe = self._command_probe("graphify")
        graphify_manifest = root / "graphify-out" / "manifest.json"
        codegraph_db = root / ".codegraph" / "codegraph.db"
        details = [
            f"codegraph_command={'found' if codegraph_probe['available'] else 'missing'}",
            f"codegraph_db={'present' if codegraph_db.exists() else 'missing'}",
            f"graphify_command={'found' if graphify_probe['available'] else 'missing'}",
            f"graphify_manifest={'present' if graphify_manifest.exists() else 'missing'}",
            f"config={'present' if config else 'missing'}",
        ]
        if not codegraph_probe["available"]:
            return self._runtime_card(
                "code_intelligence",
                "Code and knowledge graph",
                "warning",
                "CODEGRAPH OPTIONAL",
                "CodeGraph is not available; MedSCALE will use manifest and file-based evidence instead.",
                details,
                "Install CodeGraph only if graph-backed research inspection is needed.",
                False,
            )
        if not graphify_probe["available"] or not graphify_manifest.exists():
            return self._runtime_card(
                "code_intelligence",
                "Code and knowledge graph",
                "warning",
                "GRAPH DEGRADED",
                "Code intelligence is partially available, but Graphify is not fully initialized.",
                details,
                "Run graphify install/status and regenerate the artifact graph.",
                False,
            )
        return self._runtime_card(
            "code_intelligence",
            "Code and knowledge graph",
            "pass",
            "GRAPH READY",
            "CodeGraph and Graphify signals are available for research workflow inspection.",
            details,
            "Next: render evidence graph status in the MedSCALE dashboard.",
            False,
        )

    def _runtime_cli_card(self, root: Path) -> dict:
        probes = {
            "python": self._command_probe("python"),
            "uv": self._command_probe("uv"),
            "node": self._command_probe("node"),
        }
        details = [
            f"{name}={'found' if probe['available'] else 'missing'}"
            for name, probe in probes.items()
        ]
        if not probes["python"]["available"]:
            return self._runtime_card(
                "cli_runtime",
                "Native medical runtime",
                "fail",
                "RUNTIME MISSING",
                "Python is required to run the standalone medical research workflow.",
                details,
                "Restore Python 3.10+ PATH availability before running the medical platform.",
                True,
            )
        if not probes["uv"]["available"]:
            return self._runtime_card(
                "cli_runtime",
                "Native medical runtime",
                "warning",
                "PYTHON READY",
                "Python is available; uv is optional but recommended for reproducible medical dependencies.",
                details,
                "Use pip or install uv for faster isolated dependency setup.",
                True,
            )
        return self._runtime_card(
            "cli_runtime",
            "Native medical runtime",
            "pass",
            "PYTHON READY",
            "Native medical workflow runtime is available without an external governance CLI.",
            details,
            "Next: expose med-research os-plan, mcp doctor, and token report commands.",
            True,
        )

    def _runtime_skills_card(self, root: Path) -> dict:
        config = self._read_workspace_json(root, ".scale/skills.json")
        domains = self._dict_value(config.get("domains"))
        required_medical_domains = [
            "medicalResearch",
            "medicalFactCheck",
            "medicalPackageAudit",
            "medicalMemory",
        ]
        missing_domains = [domain for domain in required_medical_domains if domain not in domains]
        details = [
            f"policy={self._dict_value(config.get('policy')).get('mode') or 'missing'}",
            f"domain_count={len(domains)}",
            f"missing_medical_domains={','.join(missing_domains) if missing_domains else 'none'}",
        ]
        if not config:
            return self._runtime_card(
                "medical_skills",
                "Medical skills",
                "warning",
                "SKILLS MISSING",
                "Skill governance is not configured for this workspace.",
                details,
                "Add medical skill domains for literature, fact check, package audit, and memory review.",
                False,
            )
        if missing_domains:
            return self._runtime_card(
                "medical_skills",
                "Medical skills",
                "warning",
                "MEDICAL DOMAINS MISSING",
                "Generic skill governance exists, but medical research roles are not first-class skill domains.",
                details,
                "Add MedSCALE skill domains and required evidence artifacts.",
                False,
            )
        return self._runtime_card(
            "medical_skills",
            "Medical skills",
            "pass",
            "SKILLS READY",
            "Medical research skill domains are configured.",
            details,
            "Next: bind each delivery gate to required skill evidence.",
            False,
        )

    def _runtime_mcp_card(self, root: Path) -> dict:
        config_dir = root / "mcp-configs"
        config_entries = [
            item for item in config_dir.iterdir()
            if config_dir.exists() and not item.name.startswith("_")
        ] if config_dir.exists() else []
        config_count = len(config_entries)
        server_yaml = root / ".scale" / "mcp-servers.yaml"
        details = [
            f"mcp_config_count={config_count}",
            f"mcp_servers_yaml={'present' if server_yaml.exists() else 'missing'}",
            f"memory_config={'present' if (config_dir / 'memory').exists() or (config_dir / 'memory.json').exists() else 'missing'}",
            f"playwright_config={'present' if (config_dir / 'playwright').exists() or (config_dir / 'playwright.json').exists() else 'missing'}",
        ]
        if config_count == 0:
            return self._runtime_card(
                "mcp_surface",
                "MCP surface",
                "warning",
                "MCP MISSING",
                "No MCP configuration files were found for this workspace.",
                details,
                "Add MCP configs for memory, evidence manifests, browser checks, and medical retrieval.",
                False,
            )
        if not server_yaml.exists():
            return self._runtime_card(
                "mcp_surface",
                "MCP surface",
                "warning",
                "MCP PARTIAL",
                "MCP configs exist, but the workspace has no MedSCALE server map contract.",
                details,
                "Add a native MedSCALE MCP server map and expose status in the medical doctor.",
                False,
            )
        return self._runtime_card(
            "mcp_surface",
            "MCP surface",
            "pass",
            "MCP READY",
            "MCP configs and server map are present.",
            details,
            "Next: add medical literature and fact-check MCP routes.",
            False,
        )

    def _runtime_token_cost_card(self, root: Path) -> dict:
        report = self._token_cost_report()
        summary = self._dict_value(report.get("summary"))
        details = [
            f"usage_path={report.get('usage_path')}",
            f"records={summary.get('total_records', 0)}",
            f"total_tokens={summary.get('total_tokens', 0)}",
            f"cache_savings_tokens={summary.get('cache_savings_tokens', 0)}",
            f"estimated_cost_usd={summary.get('estimated_cost_usd') if summary.get('estimated_cost_usd') is not None else 'unknown'}",
        ]
        if not summary.get("total_records"):
            return self._runtime_card(
                "token_cost",
                "Token and cost ledger",
                "warning",
                "COST PENDING",
                "MedSCALE token/cost reporting is wired, but no medical model usage has been recorded yet.",
                details,
                "Record usage with medscale token record after literature review, fact check, package audit, agent review, and memory settlement.",
                False,
            )
        return self._runtime_card(
            "token_cost",
            "Token and cost ledger",
            "pass",
            "COST TRACKED",
            "MedSCALE has recorded model usage for cost and token review.",
            details,
            "Review medscale token report before package delivery and expert handoff.",
            False,
        )

    def _runtime_medical_workflow_card(self, root: Path) -> dict:
        platform = root / "target-research-platform"
        if not platform.exists() and (self.base_dir / "main.py").exists():
            platform = self.base_dir
        main_py = platform / "main.py"
        requirements = platform / "requirements.txt"
        tests_dir = platform / "tests"
        dashboard_app = platform / "src" / "dashboard" / "app.py"
        details = [
            f"platform={'present' if platform.exists() else 'missing'}",
            f"main_py={'present' if main_py.exists() else 'missing'}",
            f"requirements={'present' if requirements.exists() else 'missing'}",
            f"tests={'present' if tests_dir.exists() else 'missing'}",
            f"dashboard_os={'present' if dashboard_app.exists() else 'missing'}",
        ]
        if not platform.exists() or not main_py.exists():
            return self._runtime_card(
                "medical_workflow",
                "Medical workflow",
                "fail",
                "PLATFORM MISSING",
                "target-research-platform is required for MedSCALE Research OS.",
                details,
                "Restore target-research-platform before running the medical workflow.",
                True,
            )
        if not requirements.exists() or not tests_dir.exists():
            return self._runtime_card(
                "medical_workflow",
                "Medical workflow",
                "warning",
                "WORKFLOW PARTIAL",
                "The medical platform exists, but dependency or test evidence is incomplete.",
                details,
                "Add medical pytest coverage to the default verification profile.",
                True,
            )
        return self._runtime_card(
            "medical_workflow",
            "Medical workflow",
            "pass",
            "WORKFLOW READY",
            "Medical platform files, dependencies, and tests are discoverable.",
            details,
            "Next: include target-research-platform pytest in native medical verification.",
            True,
        )

    @staticmethod
    def _runtime_readiness_score(cards: list[dict]) -> int:
        if not cards:
            return 0
        weights = {"pass": 100, "warning": 55, "pending": 25, "fail": 0}
        return round(sum(weights.get(str(card.get("state")), 0) for card in cards) / len(cards))

    @staticmethod
    def _runtime_recommendations(cards: list[dict]) -> list[str]:
        items = []
        for card in cards:
            if card.get("state") in {"fail", "warning"} and card.get("next_action"):
                items.append(str(card["next_action"]))
        if not items:
            items.append("Run the native MedSCALE doctor before external expert review.")
        return items[:6]

    def _medical_os_signals(self, readiness: dict, researcher_cards: list[object]) -> list[dict]:
        card_by_id = {
            str(card.get("id")): card
            for card in researcher_cards
            if isinstance(card, dict) and card.get("id")
        }
        literature = self._dict_value(readiness.get("literature_evidence"))
        literature_state = "pending"
        literature_summary = "等待文献评述和富集证据。"
        agent_or_llm = self._int_value(literature.get("agent_or_llm_count"))
        if literature.get("upgrade_needed"):
            literature_state = "warning"
            literature_summary = "仍含规则回退评述，建议升级到 Agent/LLM 深度评述。"
        elif agent_or_llm > 0:
            literature_state = "pass"
            literature_summary = "已有 Agent/LLM 文献评述信号。"
        elif self._int_value(literature.get("count")) > 0:
            literature_state = "warning"
            literature_summary = "有文献证据，但深度评述信号不足。"

        signals = [
            self._signal_from_card(
                card_by_id.get("quality"),
                "quality_gate",
                "论文质量门禁",
                "pending",
                "等待质量门禁报告。",
            ),
            self._signal_from_card(
                card_by_id.get("fact_check"),
                "fact_check",
                "医学事实核查",
                "pending",
                "等待事实核查报告。",
            ),
            self._signal_from_card(
                card_by_id.get("package_audit"),
                "package_audit",
                "交付包审计",
                "pending",
                "等待 ZIP/manifest/README 自检。",
            ),
            {
                "id": "literature_review",
                "label": "文献评述来源",
                "state": literature_state,
                "summary": literature_summary,
                "evidence": [
                    f"reviews={literature.get('count', 0)}",
                    f"agent_or_llm={agent_or_llm}",
                    f"rule_based={literature.get('rule_based_count', 0)}",
                ],
            },
            self._signal_from_card(
                card_by_id.get("memory_seed"),
                "memory_seed",
                "gbrain 记忆播种",
                "pending",
                "等待 memory seed。",
            ),
            self._signal_from_card(
                card_by_id.get("learning_candidate"),
                "learning_candidate",
                "学习候选沉淀",
                "pending",
                "等待 learning candidate。",
            ),
        ]
        return signals

    @staticmethod
    def _signal_from_card(
        card: dict | None,
        signal_id: str,
        label: str,
        default_state: str,
        default_summary: str,
    ) -> dict:
        if not card:
            return {
                "id": signal_id,
                "label": label,
                "state": default_state,
                "summary": default_summary,
                "evidence": [],
            }
        details = card.get("details") if isinstance(card.get("details"), list) else []
        return {
            "id": signal_id,
            "label": label,
            "state": str(card.get("state") or default_state),
            "summary": str(card.get("summary") or default_summary),
            "evidence": [str(item) for item in details[:4]],
        }

    @staticmethod
    def _medical_os_score(signals: list[dict]) -> int:
        if not signals:
            return 0
        weights = {"pass": 100, "warning": 60, "pending": 0, "fail": 0}
        total = sum(weights.get(str(signal.get("state")), 0) for signal in signals)
        return round(total / len(signals))

    @staticmethod
    def _medical_os_status(score: int, signals: list[dict]) -> str:
        if any(signal.get("state") == "fail" for signal in signals):
            return "blocked"
        if score >= 90:
            return "ready-for-expert-review"
        if score >= 60:
            return "needs-researcher-review"
        return "insufficient-evidence"

    @staticmethod
    def _medical_os_recommendations(signals: list[dict]) -> list[str]:
        recommendations = []
        for signal in signals:
            state = signal.get("state")
            if state == "fail":
                recommendations.append(f"先修复 {signal.get('label')} 的阻断项，再进入外部审阅。")
            elif state == "warning":
                recommendations.append(f"复核 {signal.get('label')} 的警告项，并补充可追溯证据。")
            elif state == "pending":
                recommendations.append(f"补齐 {signal.get('label')}，让研究者视图形成闭环。")
        if not recommendations:
            recommendations.append("进入医学专家复审，并保留人工结论与证据包。")
        return recommendations[:5]

    @staticmethod
    def _medical_os_roles(signals: list[dict]) -> list[dict]:
        state_by_id = {signal.get("id"): signal.get("state") for signal in signals}
        return [
            {
                "id": "principal_investigator",
                "name": "Principal Investigator",
                "responsibility": "orchestrator",
                "state": "warning",
                "reason": "负责医学边界、研究问题、人工最终结论和伦理/投稿约束。",
            },
            {
                "id": "literature_reviewer",
                "name": "Literature Reviewer",
                "responsibility": "specialist",
                "state": state_by_id.get("literature_review", "pending"),
                "reason": "负责 PubMed/OpenAlex/Agent 评述证据和引用质量。",
            },
            {
                "id": "manuscript_quality_reviewer",
                "name": "Manuscript Quality Reviewer",
                "responsibility": "verifier",
                "state": state_by_id.get("quality_gate", "pending"),
                "reason": "负责 IMRaD 结构、图表、质量门禁和投递前检查。",
            },
            {
                "id": "medical_fact_checker",
                "name": "Medical Fact Checker",
                "responsibility": "reviewer",
                "state": state_by_id.get("fact_check", "pending"),
                "reason": "负责 PMID、统计数字、医学声明和图表引用核查。",
            },
            {
                "id": "delivery_steward",
                "name": "Delivery Steward",
                "responsibility": "releaser",
                "state": state_by_id.get("package_audit", "pending"),
                "reason": "负责 ZIP、manifest、README、下载物和归档一致性。",
            },
            {
                "id": "memory_curator",
                "name": "Memory Curator",
                "responsibility": "specialist",
                "state": state_by_id.get("memory_seed", "pending"),
                "reason": "负责 gbrain 播种、learning candidate 和长期知识复审。",
            },
        ]

    @staticmethod
    def _medical_os_handoffs() -> list[dict]:
        return [
            {
                "from": "literature_reviewer",
                "to": "medical_fact_checker",
                "artifact": "literature evidence pack",
                "exit_criteria": ["关键 claims 有 PMID 或可追溯来源", "规则回退评述已标记"],
            },
            {
                "from": "medical_fact_checker",
                "to": "manuscript_quality_reviewer",
                "artifact": "fact check report",
                "exit_criteria": ["failed claims 为 0", "unverified claims 有人工复核待办"],
            },
            {
                "from": "manuscript_quality_reviewer",
                "to": "delivery_steward",
                "artifact": "quality gate report",
                "exit_criteria": ["质量门禁通过或阻断项已记录", "图表与元数据可归档"],
            },
            {
                "from": "delivery_steward",
                "to": "memory_curator",
                "artifact": "delivery manifest",
                "exit_criteria": ["ZIP 自检通过", "memory seed 源文件列表完整"],
            },
        ]

    @staticmethod
    def _medical_os_review_gates(signals: list[dict]) -> list[dict]:
        return [
            {
                "id": signal.get("id"),
                "owner": {
                    "quality_gate": "manuscript_quality_reviewer",
                    "fact_check": "medical_fact_checker",
                    "package_audit": "delivery_steward",
                    "literature_review": "literature_reviewer",
                    "memory_seed": "memory_curator",
                    "learning_candidate": "memory_curator",
                }.get(str(signal.get("id")), "principal_investigator"),
                "required": True,
                "state": signal.get("state"),
                "reason": signal.get("summary"),
            }
            for signal in signals
        ]

    @staticmethod
    def _medical_os_prompt_templates() -> list[dict]:
        return [
            {
                "id": "med-target-scout",
                "title": "靶点研究任务定义",
                "phase": "define",
                "role": "principal_investigator",
                "output": "研究问题、边界声明、目标疾病和证据需求。",
            },
            {
                "id": "med-literature-review",
                "title": "PubMed/OpenAlex 文献评述",
                "phase": "research",
                "role": "literature_reviewer",
                "output": "PMID、MeSH、引用数、证据等级和争议点。",
            },
            {
                "id": "med-manuscript-imrad",
                "title": "医学论文 IMRaD 草稿",
                "phase": "build",
                "role": "manuscript_quality_reviewer",
                "output": "结构化论文草稿、图表嵌入和投稿边界。",
            },
            {
                "id": "med-fact-check",
                "title": "医学事实核查",
                "phase": "verify",
                "role": "medical_fact_checker",
                "output": "claims、PMID、数字、图表引用和未验证项。",
            },
            {
                "id": "med-package-audit",
                "title": "交付包审计",
                "phase": "ship",
                "role": "delivery_steward",
                "output": "ZIP、manifest、README、断链和下载物一致性。",
            },
            {
                "id": "med-memory-learning",
                "title": "记忆播种与学习候选",
                "phase": "learn",
                "role": "memory_curator",
                "output": "gbrain seed、learning candidate 和人工复审建议。",
            },
        ]

    @staticmethod
    def _medical_os_memory_strategy(readiness: dict) -> dict:
        memory_seed = readiness.get("memory_seed") if isinstance(readiness.get("memory_seed"), dict) else {}
        learning_candidate = readiness.get("learning_candidate") if isinstance(readiness.get("learning_candidate"), dict) else {}
        review_status = str(learning_candidate.get("review_status") or "pending").strip().lower()
        if review_status in {"approved", "rejected", "stale", "restored"}:
            candidate_state = review_status
        elif learning_candidate.get("promotable"):
            candidate_state = "promotable"
        else:
            candidate_state = "review-required"
        return {
            "provider": memory_seed.get("provider") or "gbrain",
            "routing": "gbrain-only",
            "seed_state": "ready" if memory_seed.get("import_ok") is True else "pending",
            "candidate_state": candidate_state,
            "review_status": review_status,
            "review_ready": bool(learning_candidate.get("review_ready")),
            "record_path": memory_seed.get("record_path"),
            "candidate_id": learning_candidate.get("candidate_id"),
            "review_path": learning_candidate.get("review_path"),
        }

    def build_medical_research_os_plan(self) -> dict:
        """Build a read-only MedSCALE OS plan packet for dashboard copy/download."""
        status = self.load_status()
        summary = self._dict_value(status.get("summary"))
        med_os = self._dict_value(summary.get("medical_research_os"))
        product = self._dict_value(med_os.get("product"))
        operating = self._dict_value(med_os.get("operating_model"))
        loop = self._dict_value(med_os.get("loop_readiness"))
        team = self._dict_value(med_os.get("research_team"))
        prompt_studio = self._dict_value(med_os.get("prompt_studio"))
        runtime_readiness = self._dict_value(med_os.get("runtime_readiness") or summary.get("medical_runtime_readiness"))
        token_cost = self._dict_value(med_os.get("token_cost"))
        templates = prompt_studio.get("templates") if isinstance(prompt_studio.get("templates"), list) else []
        roles = team.get("roles") if isinstance(team.get("roles"), list) else []
        handoffs = team.get("handoffs") if isinstance(team.get("handoffs"), list) else []
        review_gates = team.get("review_gates") if isinstance(team.get("review_gates"), list) else []
        signals = loop.get("signals") if isinstance(loop.get("signals"), list) else []
        recommendations = loop.get("recommendations") if isinstance(loop.get("recommendations"), list) else []
        target = str(status.get("target") or "").strip() or "{{target}}"
        disease = str(status.get("disease") or "").strip() or "{{disease}}"

        return {
            "schema": "medscale.research_os.plan.v1",
            "generated_at": datetime.now().isoformat(),
            "run": {
                "run_id": status.get("run_id"),
                "status": status.get("status"),
                "target": target,
                "disease": disease,
                "updated_at": status.get("updated_at"),
            },
            "product": {
                "name": product.get("name") or "MedSCALE Research OS",
                "cn_name": product.get("cn_name") or "MedSCALE 医研操作系统",
                "source_upgrade": product.get("source_upgrade") or "MedSCALE native workflow",
                "tagline": product.get("tagline"),
            },
            "agent_collaboration_plan": {
                "strategy": operating.get("strategy") or "medical-agent-collaboration-v1",
                "mode": operating.get("mode") or "multi-agent",
                "roles": roles,
                "edges": [
                    {
                        "from": handoff.get("from"),
                        "to": handoff.get("to"),
                        "type": "handoff",
                        "reason": handoff.get("artifact"),
                    }
                    for handoff in handoffs
                    if isinstance(handoff, dict)
                ],
                "handoffs": handoffs,
                "review_gates": review_gates,
                "budget": team.get("budget") or {},
                "summary": {
                    "total_roles": len(roles),
                    "required_roles": len([role for role in roles if isinstance(role, dict)]),
                    "review_gate_count": len(review_gates),
                    "handoff_count": len(handoffs),
                    "multi_agent_recommended": True,
                    "review_escalated": operating.get("mode") == "review-escalated",
                },
                "recommendations": recommendations,
            },
            "agent_loop_readiness": {
                "status": operating.get("status") or "insufficient-evidence",
                "score": operating.get("readiness_score") or loop.get("score") or 0,
                "summary": {
                    "ready_signals": operating.get("ready_signals") or 0,
                    "warning_signals": operating.get("warning_signals") or 0,
                    "missing_signals": operating.get("missing_signals") or 0,
                    "recommendations": recommendations,
                },
                "signals": signals,
            },
            "prompt_studio": {
                "safe_preview": True,
                "templates": [
                    {
                        **template,
                        "copy_prompt": self._medical_prompt_text(template, target, disease),
                        "download_filename": f"medscale-{template.get('id', 'prompt')}.md",
                    }
                    for template in templates
                    if isinstance(template, dict)
                ],
            },
            "memory_strategy": med_os.get("memory_strategy") or {},
            "token_cost": token_cost,
            "runtime_readiness": runtime_readiness,
            "safety": {
                "read_only": True,
                "shell_execution": False,
                "medical_boundary": "This plan supports research workflow governance only. It is not clinical advice and requires human expert review.",
            },
            "next_migrations": med_os.get("next_migrations") or [],
        }

    @staticmethod
    def _medical_prompt_text(template: dict, target: str, disease: str) -> str:
        title = template.get("title") or template.get("id") or "MedSCALE prompt"
        role = template.get("role") or "medical_research_agent"
        phase = template.get("phase") or "research"
        output = template.get("output") or "Produce a traceable research artifact."
        return "\n".join([
            f"# {title}",
            "",
            f"Product: MedSCALE Research OS",
            f"Role: {role}",
            f"Phase: {phase}",
            f"Target: {target}",
            f"Disease: {disease}",
            "",
            "## Objective",
            str(output),
            "",
            "## Evidence Rules",
            "- Cite PMID, DOI, dataset, figure, or manifest path when available.",
            "- Separate observed evidence from inference.",
            "- Mark unresolved medical claims as requiring human expert review.",
            "- Do not present draft research output as clinical advice.",
            "",
            "## Output",
            "- Summary",
            "- Evidence table",
            "- Risks and unresolved claims",
            "- Next action for the responsible reviewer",
        ])

    @staticmethod
    def _literature_evidence(manifest: dict) -> dict:
        literature = manifest.get("literature") or {}
        enrichment = literature.get("enrichment") or {}
        agent_cache_count = int(literature.get("agent_cache_count", 0) or 0)
        llm_count = int(literature.get("llm_count", 0) or 0)
        rule_based_count = int(literature.get("rule_based_count", 0) or 0)
        return {
            "count": literature.get("count", 0),
            "agent_cache_count": agent_cache_count,
            "llm_count": llm_count,
            "rule_based_count": rule_based_count,
            "agent_or_llm_count": agent_cache_count + llm_count,
            "upgrade_needed": rule_based_count > 0 and (agent_cache_count + llm_count) == 0,
            "sources": enrichment.get("sources") or [],
            "mesh_count": enrichment.get("mesh_count", 0),
            "citation_count_available": enrichment.get("citation_count_available", 0),
            "cache_used": bool(enrichment.get("cache_used")),
            "cache_hit_count": enrichment.get("cache_hit_count", 0),
        }

    @staticmethod
    def _manifest_file_path(manifest: dict, role: str) -> str | None:
        for item in manifest.get("files") or []:
            if item.get("role") == role and item.get("path"):
                return str(item["path"])
        return None

    def _literature_review_examples(self, manifest: dict) -> list[dict]:
        meta_path = self._resolve_artifact_path(self._manifest_file_path(manifest, "manuscript_meta"))
        meta = self._read_json(meta_path)
        reviews = meta.get("literature_reviews") or []
        examples: list[dict] = []
        for item in reviews[:6]:
            examples.append({
                "index": item.get("index"),
                "pmid": item.get("pmid"),
                "title": item.get("title"),
                "study_design": item.get("study_design"),
                "evidence_level": item.get("evidence_level"),
                "source": item.get("source"),
            })
        if examples:
            return examples

        task_path = self._resolve_artifact_path(self._manifest_file_path(manifest, "agent_review_tasks"))
        tasks = self._read_json(task_path)
        papers = tasks.get("papers") or []
        for item in papers[:6]:
            examples.append({
                "index": item.get("index"),
                "pmid": item.get("pmid"),
                "title": item.get("title"),
                "study_design": item.get("study_design"),
                "evidence_level": None,
                "source": "pending_agent_review",
            })
        return examples

    def _literature_review_files(self, manifest: dict) -> dict:
        task_path = self._resolve_artifact_path(self._manifest_file_path(manifest, "agent_review_tasks"))
        cache_path = self._resolve_artifact_path(self._manifest_file_path(manifest, "agent_reviews"))
        return {
            "task_path": str(task_path) if task_path and task_path.exists() else None,
            "cache_path": str(cache_path) if cache_path and cache_path.exists() else None,
        }

    @staticmethod
    def _string_list(value: object) -> list[str]:
        if not isinstance(value, list):
            return []
        items: list[str] = []
        for item in value:
            text = str(item).strip()
            if text:
                items.append(text)
        return items

    def _memory_seed_status(self, manifest_path: Path | None) -> dict:
        if not manifest_path:
            return {
                "record_path": None,
                "summary_path": None,
                "provider": None,
                "generated_at": None,
                "record_ready": False,
                "summary_ready": False,
                "import_ok": None,
                "source_file_count": 0,
                "staged_file_count": 0,
                "missing_roles": [],
                "warnings": [],
            }

        slug = manifest_path.name.replace("_delivery_manifest.json", "")
        record_path = manifest_path.with_name(f"{slug}_memory_seed.json")
        summary_path = manifest_path.with_name(f"{slug}_memory_summary.md")
        record = self._read_json(record_path)

        summary_from_record = record.get("summary_path") if record else None
        if isinstance(summary_from_record, str) and summary_from_record.strip():
            resolved_summary = self._resolve_artifact_path(summary_from_record)
            if resolved_summary:
                summary_path = resolved_summary

        source_files = self._string_list(record.get("source_files") if record else None)
        staged_files = self._string_list(record.get("staged_files") if record else None)
        missing_roles = self._string_list(record.get("missing_roles") if record else None)
        warnings = self._string_list(record.get("warnings") if record else None)
        provider_raw = str(record.get("provider") or "").strip() if record else ""
        generated_at_raw = str(record.get("generated_at") or "").strip() if record else ""
        import_ok_raw = record.get("import_ok") if record else None

        return {
            "record_path": str(record_path) if record_path.exists() else None,
            "summary_path": str(summary_path) if summary_path.exists() else None,
            "provider": provider_raw or None,
            "generated_at": generated_at_raw or None,
            "record_ready": record_path.exists(),
            "summary_ready": summary_path.exists(),
            "import_ok": import_ok_raw if isinstance(import_ok_raw, bool) else None,
            "source_file_count": len(source_files),
            "staged_file_count": len(staged_files),
            "missing_roles": missing_roles,
            "warnings": warnings,
        }

    def _learning_candidate_review_status(self, record: dict, record_path: Path) -> dict:
        candidate_id = str(record.get("candidate_id") or "").strip()
        candidate_path = self._resolve_artifact_path(record.get("candidate_path"))
        review_path = self._resolve_artifact_path(
            record.get("review_path") or record.get("reviewPath")
        )
        if not review_path and candidate_path:
            review_path = candidate_path.with_name(f"{candidate_path.stem}.review.json")
        if not review_path and candidate_id:
            review_path = self.base_dir / ".scale" / "memory" / "learning-candidates" / f"{candidate_id}.review.json"
        if not review_path:
            review_path = record_path.with_name(f"{record_path.stem}.review.json")

        review = self._read_json(review_path)
        review_status = str(review.get("status") or "pending").strip().lower() if review else "pending"
        review_markdown_path = self._resolve_artifact_path(
            review.get("reviewMarkdownPath") or review.get("review_markdown_path")
        ) if review else None
        if not review_markdown_path and review_path:
            review_markdown_path = review_path.with_suffix(".md")

        return {
            "review_status": review_status,
            "review_ready": bool(review),
            "review_path": str(review_path) if review_path and review_path.exists() else None,
            "review_expected_path": str(review_path) if review_path else None,
            "review_markdown_path": str(review_markdown_path) if review_markdown_path and review_markdown_path.exists() else None,
            "reviewer": review.get("reviewer") if review else None,
            "review_reason": review.get("reason") if review else None,
            "review_updated_at": (review.get("updatedAt") or review.get("updated_at")) if review else None,
            "review_node_id": (review.get("nodeId") or review.get("node_id")) if review else None,
            "review_node_status": (review.get("nodeStatus") or review.get("node_status")) if review else None,
            "promoted": bool(review.get("promoted")) if review else False,
            "review_warnings": self._string_list(review.get("warnings") if review else None),
        }

    def _learning_candidate_status(self, manifest_path: Path | None) -> dict:
        if not manifest_path:
            return {
                "candidate_id": None,
                "record_path": None,
                "summary_path": None,
                "candidate_path": None,
                "candidate_markdown_path": None,
                "generated_at": None,
                "recommended_action": None,
                "promotable": False,
                "brain_ingest_ok": None,
                "brain_node_id": None,
                "record_ready": False,
                "summary_ready": False,
                "warnings": [],
                "review_status": "pending",
                "review_ready": False,
                "review_path": None,
                "review_expected_path": None,
                "review_markdown_path": None,
                "reviewer": None,
                "review_reason": None,
                "review_updated_at": None,
                "review_node_id": None,
                "review_node_status": None,
                "promoted": False,
                "review_warnings": [],
            }

        slug = manifest_path.name.replace("_delivery_manifest.json", "")
        record_path = manifest_path.with_name(f"{slug}_memory_learning_candidate.json")
        summary_path = manifest_path.with_name(f"{slug}_memory_learning_candidate.md")
        record = self._read_json(record_path)
        review_status = self._learning_candidate_review_status(record, record_path) if record else {
            "review_status": "pending",
            "review_ready": False,
            "review_path": None,
            "review_expected_path": None,
            "review_markdown_path": None,
            "reviewer": None,
            "review_reason": None,
            "review_updated_at": None,
            "review_node_id": None,
            "review_node_status": None,
            "promoted": False,
            "review_warnings": [],
        }

        return {
            "candidate_id": record.get("candidate_id"),
            "record_path": str(record_path) if record_path.exists() else None,
            "summary_path": str(summary_path) if summary_path.exists() else None,
            "candidate_path": record.get("candidate_path"),
            "candidate_markdown_path": record.get("candidate_markdown_path"),
            "generated_at": record.get("generated_at"),
            "recommended_action": record.get("recommended_action"),
            "promotable": bool(record.get("promotable")),
            "brain_ingest_ok": record.get("brain_ingest_ok") if isinstance(record.get("brain_ingest_ok"), bool) else None,
            "brain_node_id": record.get("brain_node_id"),
            "record_ready": record_path.exists(),
            "summary_ready": summary_path.exists(),
            "warnings": self._string_list(record.get("warnings") if record else None),
            **review_status,
        }

    def start_pipeline(self, payload: dict) -> tuple[bool, str]:
        with self._lock:
            if self._process and self._process.poll() is None:
                return False, "A pipeline run is already in progress."

            run_id = uuid.uuid4().hex[:10]
            target = payload.get("target", "CDK4").strip() or "CDK4"
            disease = payload.get("disease", "breast cancer").strip() or "breast cancer"
            cancers_raw = payload.get("cancers", "BRCA,LUAD")
            cancers = [item.strip() for item in cancers_raw.split(",") if item.strip()]
            if not cancers:
                cancers = ["BRCA", "LUAD"]
            modality = payload.get("modality", "small_molecule").strip() or "small_molecule"
            risk_level = payload.get("risk_level", "medium").strip() or "medium"

            cmd = [
                sys.executable,
                "main.py",
                "full",
                "--target",
                target,
                "--disease",
                disease,
                "--modality",
                modality,
                "--risk-level",
                risk_level,
                "--output",
                "./output",
                "--cache",
                "./cache",
            ]
            if cancers:
                cmd.append("--cancers")
                cmd.extend(cancers)

            bootstrap_code = (
                "import argparse, uuid; "
                "from pathlib import Path; "
                "import main as pipeline_main; "
                f"tracker = pipeline_main.LiveStatusTracker(Path(r'{self.status_file}')); "
                "args = argparse.Namespace("
                f"target={target!r}, disease={disease!r}, cancers={cancers!r}, "
                "ensg=None, modality="
                f"{modality!r}, risk_level={risk_level!r}, output='./output', cache='./cache', json=False, "
                f"_tracker=tracker, _run_id={run_id!r}"
                "); "
                "pipeline_main.run_full_pipeline(args)"
            )
            process_cmd = [sys.executable, "-c", bootstrap_code]

            self.tracker.start_run(
                {
                    "run_id": run_id,
                    "target": target,
                    "disease": disease,
                    "cancers": cancers,
                    "modality": modality,
                    "risk_level": risk_level,
                    "output_root": "./output",
                }
            )
            self.tracker.log(f"Spawning pipeline process: {' '.join(cmd)}")
            self._process = subprocess.Popen(
                process_cmd,
                cwd=self.base_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            threading.Thread(target=self._pump_logs, daemon=True).start()
            return True, run_id

    def _pump_logs(self) -> None:
        process = self._process
        if not process or not process.stdout:
            return
        for line in process.stdout:
            message = line.rstrip()
            if message:
                self.tracker.log(message)
        return_code = process.wait()
        if return_code != 0:
            self.tracker.fail_run(f"Pipeline process exited with code {return_code}")
        with self._lock:
            self._process = None

    def review_memory_candidate(self, payload: dict) -> tuple[bool, dict, HTTPStatus]:
        """Run the native MedSCALE Memory Brain review command from the dashboard."""
        if not isinstance(payload, dict):
            payload = {}
        action = str(payload.get("action") or "").strip().lower()
        if action not in {"approve", "reject", "stale", "restore"}:
            return False, {"ok": False, "error": "action must be approve, reject, stale, or restore"}, HTTPStatus.BAD_REQUEST

        candidate_id = str(payload.get("candidate_id") or payload.get("candidateId") or "").strip()
        reviewer = str(payload.get("reviewer") or "18766-dashboard").strip() or "18766-dashboard"
        reason = str(payload.get("reason") or "").strip()
        scope = str(payload.get("scope") or "").strip()
        project_root = self._medscale_project_root()
        command = self._medscale_memory_review_command(project_root)
        if not command:
            return False, {
                "ok": False,
                "error": "MedSCALE CLI entrypoint is unavailable. Run npm install and npm run build, or use npm run medscale.",
            }, HTTPStatus.SERVICE_UNAVAILABLE

        args = [
            *command,
            "memory-review",
            action,
            "--dir",
            str(project_root),
            "--reviewer",
            reviewer,
            "--json",
        ]
        if candidate_id:
            args.extend(["--candidate-id", candidate_id])
        if reason:
            args.extend(["--reason", reason])
        if scope:
            args.extend(["--scope", scope])

        try:
            completed = subprocess.run(
                args,
                cwd=str(project_root),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=60,
            )
        except FileNotFoundError as exc:
            return False, {"ok": False, "error": f"MedSCALE command not found: {exc}"}, HTTPStatus.SERVICE_UNAVAILABLE
        except subprocess.TimeoutExpired:
            return False, {"ok": False, "error": "Memory review command timed out."}, HTTPStatus.REQUEST_TIMEOUT

        stdout = (completed.stdout or "").strip()
        stderr = (completed.stderr or "").strip()
        report: dict = {}
        if stdout:
            try:
                parsed = json.loads(stdout)
                report = parsed if isinstance(parsed, dict) else {}
            except json.JSONDecodeError:
                return False, {
                    "ok": False,
                    "error": "Memory review command returned non-JSON output.",
                    "stdout": stdout[-1000:],
                    "stderr": stderr[-1000:],
                }, HTTPStatus.INTERNAL_SERVER_ERROR

        ok = completed.returncode == 0 and report.get("ok") is not False
        response = {
            "ok": ok,
            "action": action,
            "candidate_id": report.get("candidateId") or report.get("candidate_id") or candidate_id or None,
            "status": report.get("status"),
            "node_id": report.get("nodeId") or report.get("node_id"),
            "node_status": report.get("nodeStatus") or report.get("node_status"),
            "review_path": report.get("reviewPath") or report.get("review_path"),
            "review_markdown_path": report.get("reviewMarkdownPath") or report.get("review_markdown_path"),
            "promoted": bool(report.get("promoted")),
            "warnings": report.get("warnings") if isinstance(report.get("warnings"), list) else [],
            "report": report,
        }
        if not ok:
            response["error"] = stderr or "Memory review command failed."
            return False, response, HTTPStatus.CONFLICT

        self.tracker.log(
            f"Memory review {action}: {response['candidate_id'] or '<latest>'} -> {response.get('status') or 'unknown'}"
        )
        return True, response, HTTPStatus.OK

    def _medscale_project_root(self) -> Path:
        candidates = [self.base_dir.parent, self.base_dir]
        for candidate in candidates:
            if (candidate / "package.json").exists() and (candidate / "src" / "api" / "medscale.ts").exists():
                return candidate.resolve()
        return self.base_dir.resolve()

    @staticmethod
    def _medscale_memory_review_command(project_root: Path) -> list[str]:
        built_entry = project_root / "dist" / "api" / "medscale.js"
        if built_entry.exists():
            return ["node", str(built_entry)]
        if (project_root / "package.json").exists():
            npm = "npm.cmd" if sys.platform.startswith("win") else "npm"
            return [npm, "run", "--silent", "medscale", "--"]
        return []


class DashboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, dashboard_state: DashboardState, **kwargs):
        self.dashboard_state = dashboard_state
        super().__init__(*args, directory=str(dashboard_state.base_dir / "src" / "dashboard" / "static"), **kwargs)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/favicon.ico":
            self.send_response(HTTPStatus.NO_CONTENT)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if parsed.path == "/api/status":
            self._send_json(self.dashboard_state.load_status())
            return
        if parsed.path == "/api/medical-research-os":
            self._send_json(self.dashboard_state.build_medical_research_os_plan())
            return
        if parsed.path == "/api/health":
            self._send_json({"ok": True})
            return
        # 新增: 产物数据 API（支持读取 stage JSON / markdown / milestones）
        if parsed.path == "/api/artifact":
            params = parse_qs(parsed.query)
            artifact_path = params.get("path", [None])[0]
            if artifact_path:
                self._serve_artifact(artifact_path)
                return
            self._send_json({"error": "Missing path parameter"}, status=HTTPStatus.BAD_REQUEST)
            return
        # 新增: 产物文件下载
        if parsed.path == "/api/download":
            params = parse_qs(parsed.query)
            file_path = params.get("path", [None])[0]
            inline = params.get("inline", ["0"])[0] in {"1", "true", "yes"}
            if file_path:
                self._serve_download(file_path, inline=inline)
                return
            self._send_json({"error": "Missing path parameter"}, status=HTTPStatus.BAD_REQUEST)
            return
        # 研究者交付物（精选 + 高级数据）
        if parsed.path == "/api/artifacts":
            self._list_artifacts()
            return
        # 靶点对比（自动发现 stage1-4 指标）
        if parsed.path == "/api/compare":
            self._send_json(build_comparison_report(self.dashboard_state.output_dir))
            return
        # 在线分析报告（从磁盘发现，不依赖 completed 状态）
        if parsed.path == "/api/reports":
            status = self.dashboard_state.load_status()
            self._send_json(build_report_bundle(
                self.dashboard_state.output_dir,
                current_target=status.get("target") or None,
                current_disease=status.get("disease") or None,
            ))
            return
        # JSON 预览摘要
        if parsed.path == "/api/preview-summary":
            params = parse_qs(parsed.query)
            artifact_path = params.get("path", [None])[0]
            if not artifact_path:
                self._send_json({"error": "Missing path"}, status=HTTPStatus.BAD_REQUEST)
                return
            self._preview_summary(artifact_path)
            return
        if parsed.path == "/":
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/run":
            self._handle_run_request()
            return
        if parsed.path == "/api/memory-review":
            self._handle_memory_review_request()
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Unknown endpoint")

    def _read_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8") if length else "{}"
        try:
            payload = json.loads(raw)
            return payload if isinstance(payload, dict) else {}
        except json.JSONDecodeError:
            return {}

    def _handle_run_request(self) -> None:
        payload = self._read_json_body()
        ok, result = self.dashboard_state.start_pipeline(payload)
        if ok:
            self._send_json({"ok": True, "run_id": result})
        else:
            self._send_json({"ok": False, "error": result}, status=HTTPStatus.CONFLICT)

    def _handle_memory_review_request(self) -> None:
        ok, payload, status = self.dashboard_state.review_memory_candidate(self._read_json_body())
        self._send_json(payload, status=status)

    def _send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_artifact(self, artifact_path: str) -> None:
        """读取并返回指定路径的文件内容（JSON/markdown/text）"""
        try:
            p = Path(artifact_path).resolve()
            # 安全检查: 只允许读取项目 output 目录下的文件
            output_dir = self.dashboard_state.output_dir.resolve()
            project_root = self.dashboard_state.base_dir.resolve()
            if not (p.is_relative_to(output_dir) or p.is_relative_to(project_root / "output")):
                self._send_json({"error": "Path outside output directory"}, status=HTTPStatus.FORBIDDEN)
                return
            if not p.exists():
                self._send_json({"error": "File not found"}, status=HTTPStatus.NOT_FOUND)
                return
            content = p.read_text(encoding="utf-8")
            suffix = p.suffix.lower()
            content_type = "application/json" if suffix == ".json" else "text/markdown" if suffix in (".md", ".markdown") else "text/plain"
            body = content.encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", f"{content_type}; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as exc:
            self._send_json({"error": str(exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)

    def _serve_download(self, file_path: str, inline: bool = False) -> None:
        """提供文件下载或内联预览"""
        try:
            p = Path(file_path).resolve()
            output_dir = self.dashboard_state.output_dir.resolve()
            project_root = self.dashboard_state.base_dir.resolve()
            if not (p.is_relative_to(output_dir) or p.is_relative_to(project_root / "output")):
                self._send_json({"error": "Path outside output directory"}, status=HTTPStatus.FORBIDDEN)
                return
            if not p.exists():
                self._send_json({"error": "File not found"}, status=HTTPStatus.NOT_FOUND)
                return
            data = p.read_bytes()
            filename = p.name
            suffix = p.suffix.lower()
            content_type = {
                ".json": "application/json",
                ".md": "text/markdown; charset=utf-8",
                ".html": "text/html; charset=utf-8",
                ".csv": "text/csv",
                ".pdf": "application/pdf",
                ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                ".png": "image/png",
                ".svg": "image/svg+xml",
                ".zip": "application/zip",
            }.get(suffix, "application/octet-stream")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Content-Disposition", build_content_disposition(filename, inline=inline))
            self.end_headers()
            self.wfile.write(data)
        except Exception as exc:
            self._send_json({"error": str(exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)

    def _preview_summary(self, artifact_path: str) -> None:
        try:
            p = Path(artifact_path).resolve()
            output_dir = self.dashboard_state.output_dir.resolve()
            if not p.is_relative_to(output_dir):
                self._send_json({"error": "Path outside output directory"}, status=HTTPStatus.FORBIDDEN)
                return
            if not p.exists() or p.suffix.lower() != ".json":
                self._send_json({"error": "JSON file not found"}, status=HTTPStatus.NOT_FOUND)
                return
            payload = json.loads(p.read_text(encoding="utf-8"))
            rows = summarize_json_preview(p.name, payload)
            self._send_json({"filename": p.name, "rows": rows, "raw_available": True})
        except Exception as exc:
            self._send_json({"error": str(exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)

    def _list_artifacts(self) -> None:
        """列出研究者关心的精选交付物"""
        status = self.dashboard_state.load_status()
        payload = list_researcher_deliverables(
            self.dashboard_state.output_dir,
            current_target=status.get("target"),
            current_disease=status.get("disease"),
        )
        payload["current_target"] = status.get("target")
        payload["current_disease"] = status.get("disease")
        self._send_json(payload)


def serve_dashboard(host: str = "127.0.0.1", port: int = 18766) -> None:
    base_dir = Path(__file__).resolve().parents[2]
    state = DashboardState(base_dir)
    handler = partial(DashboardHandler, dashboard_state=state)
    server = ThreadingHTTPServer((host, port), handler)
    print(f"医学研究工作台 available at http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Local dashboard for target research pipeline")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=18766)
    args = parser.parse_args()
    serve_dashboard(args.host, args.port)


if __name__ == "__main__":
    main()
