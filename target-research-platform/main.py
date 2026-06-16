#!/usr/bin/env python3
"""
药物靶点智能研究平台 - 主入口

用法:
  # 人类可读输出
  python main.py stage1 --gene CDK4 --cancers BRCA LUAD

  # Agent 可解析的 JSON 输出
  python main.py stage1 --gene CDK4 --cancers BRCA LUAD --json

  # 完整 Pipeline（阶段间自动传递数据）
  python main.py full --target CDK4 --disease "breast cancer" --cancers BRCA LUAD --json
"""
import argparse
import json
import os
import uuid
import sys
import traceback
from contextlib import contextmanager
from pathlib import Path


@contextmanager
def _redirect_stdout_to_stderr():
    """JSON 模式下将 pipeline 的 print 输出重定向到 stderr"""
    old_stdout = sys.stdout
    sys.stdout = sys.stderr
    try:
        yield
    finally:
        sys.stdout = old_stdout


@contextmanager
def _noop():
    """空操作上下文管理器"""
    yield

# 添加src到路径
sys.path.insert(0, str(Path(__file__).parent))

from src.analysis.stage1_expression import Stage1Pipeline
from src.analysis.stage2_screening import Stage2Pipeline
from src.analysis.stage3_deep_research import Stage3Pipeline
from src.analysis.stage4_business import Stage4Pipeline
from src.dashboard.status_tracker import LiveStatusTracker
from src.dashboard.app import serve_dashboard
from src.output.delivery_packager import package_existing_delivery
from src.output.manuscript_generator import generate_manuscript_from_stages


def _ensure_utf8_stdio() -> None:
    """Windows 控制台默认 GBK，JSON 输出含特殊字符时会失败。"""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass


def _output(result: dict, json_mode: bool):
    """统一输出：JSON 模式写 stdout，人类模式打印摘要"""
    if json_mode:
        _ensure_utf8_stdio()
        print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
    else:
        _print_summary(result)


def _error(
    stage: str,
    error_msg: str,
    issues: list = None,
    json_mode: bool = False,
    quiet: bool = False,
) -> dict:
    """统一错误输出"""
    result = {
        "success": False,
        "stage": stage,
        "error": error_msg
    }
    if issues:
        result["issues"] = issues
    if not quiet:
        _output(result, json_mode)
    return result


def _manuscript_status_file(output_root: Path) -> Path:
    return output_root / "dashboard_runtime" / "live_status.json"


def _manuscript_artifacts(result: dict) -> dict:
    paths = result.get("paths") or {}
    mapping = {
        "markdown": "manuscript_markdown",
        "zhongliu": "manuscript_zhongliu",
        "metadata": "manuscript_meta",
        "fact_check": "manuscript_fact_check",
        "quality": "manuscript_quality",
        "docx": "manuscript_docx",
        "figures_dir": "manuscript_figures_dir",
        "literature_evidence_pack": "literature_evidence_pack",
        "agent_review_tasks": "manuscript_review_tasks",
        "agent_reviews": "manuscript_agent_reviews",
        "delivery_manifest": "delivery_manifest",
        "delivery_package": "delivery_package",
    }
    artifacts = {}
    for source_key, artifact_key in mapping.items():
        value = paths.get(source_key)
        if value:
            artifacts[artifact_key] = value
    return artifacts


def _write_manuscript_runtime_status(
    output_root: Path,
    target: str,
    disease: str,
    result: dict,
) -> None:
    tracker = LiveStatusTracker(_manuscript_status_file(output_root))
    stage = result.get("stage") or "manuscript"
    tracker.start_run(
        {
            "run_id": f"{stage}-{uuid.uuid4().hex[:12]}",
            "target": target,
            "disease": disease,
            "cancers": [],
            "modality": "manuscript",
            "risk_level": "draft",
            "output_root": str(output_root.resolve()),
        }
    )
    if result.get("success"):
        tracker.finish_run(
            {
                "stage": stage,
                "target": target,
                "disease": disease,
                "reference_count": result.get("reference_count"),
                "char_count": result.get("char_count"),
                "zhongliu_char_count": result.get("zhongliu_char_count"),
                "literature_reviews": result.get("literature_reviews", {}),
                "fact_check": result.get("fact_check", {}),
                "quality_gate": result.get("quality_gate", {}),
                "delivery_package": result.get("delivery_package") or (result.get("paths") or {}).get("delivery_package"),
                "package_audit": result.get("package_audit", {}),
                "disclaimer": result.get("disclaimer"),
            },
            _manuscript_artifacts(result),
        )
    else:
        tracker.fail_run(result.get("error", "Manuscript generation failed"))


def _print_summary(result: dict):
    """人类可读的摘要输出"""
    stage = result.get("stage", "")
    summary = result.get("summary", {})

    print(f"\n{'=' * 60}")
    print(f"阶段{stage[-1]}分析摘要" if stage else "分析摘要")
    print(f"{'=' * 60}")

    if stage == "stage1":
        print(f"基因: {summary.get('gene')}")
        print(f"癌种: {', '.join(summary.get('cancer_types', []))}")
        print(f"数据来源: {', '.join(summary.get('data_sources', []))}")
        print(f"置信度: {summary.get('confidence_level')}")
    elif stage == "stage2":
        print(f"疾病: {summary.get('disease')}")
        print(f"数据来源: {', '.join(summary.get('data_sources', []))}")
        print(f"\n候选靶点:")
        for i, c in enumerate(summary.get("top_candidates", [])[:10], 1):
            print(f"  {i}. {c['gene']} (评分={c['score']:.3f}, {c.get('class', '')})")
    elif stage == "stage3":
        print(f"靶点: {summary.get('target')}")
        print(f"疾病: {summary.get('disease') or '通用'}")
        dev = summary.get("developability", {})
        if dev:
            print(f"\n可开发性: {dev.get('interpretation', '')}")
        print(f"\n研发建议:")
        for rec in summary.get("recommendations", []):
            print(f"  - {rec}")
    elif stage == "stage4":
        print(f"靶点: {summary.get('target')}")
        milestones = summary.get("milestones", {})
        if milestones:
            print(f"\n里程碑:")
            print(f"  总时长: {milestones.get('total_duration', 'N/A')}")
            print(f"  总成本: {milestones.get('total_cost', 'N/A')}")
            print(f"  成功率: {milestones.get('success_rate', 'N/A')}")

    print(f"\n关键发现:")
    for finding in summary.get("key_findings", []):
        print(f"  - {finding}")

    print(f"\n关键产出:")
    for output in summary.get("key_outputs", []):
        print(f"  - {output}")

    print(f"{'=' * 60}")


def run_stage1(args) -> dict:
    """运行阶段1分析"""
    pipeline = Stage1Pipeline(
        output_dir=args.output,
        cache_dir=args.cache
    )

    json_mode = getattr(args, 'json', False)

    # 验证输入
    is_valid, issues = pipeline.validate_inputs(args.gene, args.cancers)
    quiet = getattr(args, "quiet", False)
    if not is_valid:
        return _error("stage1", "输入验证失败", issues, json_mode, quiet=quiet)

    try:
        with _redirect_stdout_to_stderr() if json_mode else _noop():
            results = pipeline.run(
                gene_symbol=args.gene,
                cancer_types=args.cancers,
                ensg_id=args.ensg
            )
        results["success"] = True
        results["stage"] = "stage1"
        if not getattr(args, "quiet", False):
            _output(results, json_mode)
        return results

    except Exception as e:
        return _error("stage1", str(e), json_mode=json_mode, quiet=quiet)


def run_stage2(args) -> dict:
    """运行阶段2分析"""
    pipeline = Stage2Pipeline(
        output_dir=args.output,
        cache_dir=args.cache
    )

    json_mode = getattr(args, 'json', False)
    quiet = getattr(args, "quiet", False)

    # 验证输入
    is_valid, issues = pipeline.validate_inputs(args.disease)
    if not is_valid:
        return _error("stage2", "输入验证失败", issues, json_mode, quiet=quiet)

    try:
        known_targets = args.exclude_targets.split(",") if args.exclude_targets else None

        normal_tissue_expr = getattr(args, 'normal_tissue_expression', None)
        cancers = getattr(args, "cancers", None) or []
        cancer_code = cancers[0] if cancers else None

        with _redirect_stdout_to_stderr() if json_mode else _noop():
            results = pipeline.run(
                disease=args.disease,
                known_targets=known_targets,
                top_n=args.top_n,
                normal_tissue_expression=normal_tissue_expr,
                cancer_code=cancer_code,
            )
        results["success"] = True
        results["stage"] = "stage2"
        if not getattr(args, "quiet", False):
            _output(results, json_mode)
        return results

    except Exception as e:
        return _error("stage2", str(e), json_mode=json_mode, quiet=quiet)


def run_stage3(args) -> dict:
    """运行阶段3分析"""
    pipeline = Stage3Pipeline(
        output_dir=args.output,
        cache_dir=args.cache
    )

    json_mode = getattr(args, 'json', False)
    quiet = getattr(args, "quiet", False)

    # 验证输入
    is_valid, issues = pipeline.validate_inputs(args.target)
    if not is_valid:
        return _error("stage3", "输入验证失败", issues, json_mode, quiet=quiet)

    try:
        with _redirect_stdout_to_stderr() if json_mode else _noop():
            results = pipeline.run(
                target_name=args.target,
                ensg_id=args.ensg,
                disease=args.disease
            )
        results["success"] = True
        results["stage"] = "stage3"
        if not quiet:
            _output(results, json_mode)
        return results

    except Exception as e:
        return _error("stage3", str(e), json_mode=json_mode, quiet=quiet)


def run_stage4(args, stage1_data=None, stage2_data=None, stage3_data=None) -> dict:
    """运行阶段4分析"""
    pipeline = Stage4Pipeline(
        output_dir=args.output,
        cache_dir=args.cache
    )

    json_mode = getattr(args, 'json', False)
    quiet = getattr(args, "quiet", False)

    # 验证输入
    is_valid, issues = pipeline.validate_inputs(args.target)
    if not is_valid:
        return _error("stage4", "输入验证失败", issues, json_mode, quiet=quiet)

    try:
        with _redirect_stdout_to_stderr() if json_mode else _noop():
            results = pipeline.run(
                target_name=args.target,
                disease=args.disease,
                stage1_data=stage1_data,
                stage2_data=stage2_data,
                stage3_data=stage3_data,
                modality=args.modality,
                risk_level=args.risk_level
            )
        results["success"] = True
        results["stage"] = "stage4"
        if not quiet:
            _output(results, json_mode)
        return results

    except Exception as e:
        return _error("stage4", str(e), json_mode=json_mode, quiet=quiet)


def run_full_pipeline(args) -> dict:
    """运行完整 Pipeline（阶段间自动传递数据）"""
    json_mode = getattr(args, "json", False)
    tracker = getattr(args, "_tracker", None)
    run_id = getattr(args, "_run_id", None) or uuid.uuid4().hex[:10]

    if not json_mode:
        print("=" * 60)
        print("药物靶点智能研究平台 - 完整分析")
        print("=" * 60)

    all_results = {
        "success": True,
        "stage": "full",
        "target": args.target,
        "disease": args.disease,
        "stages": {},
    }

    if tracker:
        tracker.start_run(
            {
                "run_id": run_id,
                "target": args.target,
                "disease": args.disease,
                "cancers": args.cancers or ["BRCA"],
                "modality": args.modality,
                "risk_level": args.risk_level,
                "output_root": args.output,
            }
        )

    if not json_mode:
        print("\n>>> 阶段1: 靶点表达全景与预后挖掘")
    if tracker:
        tracker.start_stage("stage1", 5)
    stage1_args = argparse.Namespace(
        gene=args.target,
        cancers=args.cancers or ["BRCA"],
        ensg=args.ensg,
        output=f"{args.output}/stage1",
        cache=args.cache,
        json=False,
        quiet=json_mode,
    )
    stage1_results = run_stage1(stage1_args)
    all_results["stages"]["stage1"] = stage1_results
    if tracker:
        tracker.complete_stage("stage1", stage1_results, 25)

    if not stage1_results.get("success"):
        all_results["success"] = False
        all_results["error"] = "阶段1失败，终止 Pipeline"
        if tracker:
            tracker.fail_run(all_results["error"])
        _output(all_results, json_mode)
        return all_results

    if not json_mode:
        print("\n>>> 阶段2: 多维靶点筛选与优先级排序")
    if tracker:
        tracker.start_stage("stage2", 30)
    stage2_args = argparse.Namespace(
        disease=args.disease,
        exclude_targets=args.target,
        top_n=20,
        output=f"{args.output}/stage2",
        cache=args.cache,
        json=False,
        quiet=json_mode,
        normal_tissue_expression=None,
        cancers=args.cancers or ["BRCA"],
    )
    stage2_results = run_stage2(stage2_args)
    all_results["stages"]["stage2"] = stage2_results
    if tracker:
        tracker.complete_stage("stage2", stage2_results, 55)

    ensg_id = args.ensg or stage1_results.get("ensg_id")
    if not json_mode:
        print("\n>>> 阶段3: 靶点深度调研与赛道格局分析")
    if tracker:
        tracker.start_stage("stage3", 60)
    stage3_args = argparse.Namespace(
        target=args.target,
        ensg=ensg_id,
        disease=args.disease,
        output=f"{args.output}/stage3",
        cache=args.cache,
        json=False,
        quiet=json_mode,
    )
    stage3_results = run_stage3(stage3_args)
    all_results["stages"]["stage3"] = stage3_results
    if tracker:
        tracker.complete_stage("stage3", stage3_results, 80)

    if not json_mode:
        print("\n>>> 阶段4: 商业计划书与里程碑规划")
    if tracker:
        tracker.start_stage("stage4", 85)
    stage4_args = argparse.Namespace(
        target=args.target,
        disease=args.disease,
        modality=args.modality,
        risk_level=args.risk_level,
        output=f"{args.output}/stage4",
        cache=args.cache,
        json=False,
        quiet=json_mode,
    )
    stage4_results = run_stage4(
        stage4_args,
        stage1_data=stage1_results,
        stage2_data=stage2_results,
        stage3_data=stage3_results,
    )
    all_results["stages"]["stage4"] = stage4_results
    if tracker:
        tracker.complete_stage("stage4", stage4_results, 95)

    all_results["summary"] = {
        "target": args.target,
        "disease": args.disease,
        "stages_completed": [
            stage_name for stage_name, result in all_results["stages"].items() if result.get("success")
        ],
        "stages_failed": [
            stage_name for stage_name, result in all_results["stages"].items() if not result.get("success")
        ],
    }
    all_results["success"] = len(all_results["summary"]["stages_failed"]) == 0

    all_results["artifacts"] = {
        "stage1_json": str(Path(args.output) / "stage1" / f"{args.target}_stage1_results.json"),
        "stage2_json": str(Path(args.output) / "stage2" / f"{args.disease}_stage2_results.json"),
        "stage3_json": str(Path(args.output) / "stage3" / f"{args.target}_{args.disease}_stage3_results.json"),
        "stage4_json": str(Path(args.output) / "stage4" / f"{args.target}_{args.disease}_stage4_results.json"),
        "stage4_markdown": str(Path(args.output) / "stage4" / f"{args.target}_{args.disease}_business_plan.md"),
        "stage4_milestones": str(Path(args.output) / "stage4" / f"{args.target}_{args.disease}_milestones.json"),
    }

    if all_results["success"]:
        if not json_mode:
            print("\n>>> 生成期刊论文草稿（IMRaD）")
        try:
            manuscript = generate_manuscript_from_stages(
                args.output,
                args.target,
                args.disease,
                stage1_results,
                stage2_results,
                stage3_results,
                stage4_results,
            )
            all_results["manuscript"] = manuscript
            paths = manuscript.get("paths") or {}
            if paths.get("markdown"):
                all_results["artifacts"]["manuscript_markdown"] = paths["markdown"]
            if paths.get("zhongliu"):
                all_results["artifacts"]["manuscript_zhongliu"] = paths["zhongliu"]
            if paths.get("figures_dir"):
                all_results["artifacts"]["manuscript_figures_dir"] = paths["figures_dir"]
            if paths.get("docx"):
                all_results["artifacts"]["manuscript_docx"] = paths["docx"]
            if paths.get("metadata"):
                all_results["artifacts"]["manuscript_meta"] = paths["metadata"]
            if not json_mode:
                print(f"  稿件 Markdown: {paths.get('markdown', '—')}")
                if paths.get("zhongliu"):
                    print(f"  中华肿瘤杂志格式: {paths['zhongliu']}")
                if paths.get("figures_dir"):
                    print(f"  论文图表目录: {paths['figures_dir']}")
                if paths.get("docx"):
                    print(f"  稿件 Word: {paths['docx']}")
        except Exception as exc:
            all_results["manuscript"] = {"success": False, "error": str(exc)}
            if not json_mode:
                print(f"  期刊论文生成失败: {exc}")

    if not json_mode:
        print("\n" + "=" * 60)
        print("完整分析完成!")
        completed = all_results["summary"]["stages_completed"]
        failed = all_results["summary"]["stages_failed"]
        print(f"成功: {', '.join(completed)}")
        if failed:
            print(f"失败: {', '.join(failed)}")
        print(f"结果保存至: {args.output}")
        print("=" * 60)
    else:
        _output(all_results, json_mode)

    if tracker:
        if all_results["success"]:
            tracker.finish_run(all_results["summary"], all_results["artifacts"])
        else:
            tracker.fail_run(all_results.get("error", "Unknown pipeline failure"))

    return all_results


def run_manuscript(args) -> dict:
    """从磁盘上的四阶段 JSON 结果生成期刊论文草稿。"""
    json_mode = getattr(args, "json", False)
    output_root = Path(args.output)
    target = args.target
    disease = args.disease
    slug = f"{target}_{disease}"

    def _load_json(path: Path) -> dict:
        if not path.exists():
            return {}
        return json.loads(path.read_text(encoding="utf-8"))

    stage1 = _load_json(output_root / "stage1" / f"{target}_stage1_results.json")
    stage2 = _load_json(output_root / "stage2" / f"{disease}_stage2_results.json")
    stage3 = _load_json(output_root / "stage3" / f"{slug}_stage3_results.json")
    stage4 = _load_json(output_root / "stage4" / f"{slug}_stage4_results.json")

    missing = [
        name
        for name, data in [
            ("stage1", stage1),
            ("stage2", stage2),
            ("stage3", stage3),
            ("stage4", stage4),
        ]
        if not data
    ]
    if missing:
        result = {
            "success": False,
            "stage": "manuscript",
            "error": f"缺少阶段结果: {', '.join(missing)}",
            "hint": f"请先运行: python main.py full --target {target} --disease \"{disease}\"",
        }
        _write_manuscript_runtime_status(output_root, target, disease, result)
        _output(result, json_mode)
        return result

    result = generate_manuscript_from_stages(
        output_root, target, disease, stage1, stage2, stage3, stage4
    )
    result["stage"] = "manuscript"
    quality_gate = result.get("quality_gate") or {}
    if getattr(args, "fail_on_quality", False) and not quality_gate.get("passed", False):
        result["success"] = False
        result["error"] = (
            "论文质量门禁未通过: "
            f"{quality_gate.get('errors', 0)} errors, {quality_gate.get('warnings', 0)} warnings"
        )
    _write_manuscript_runtime_status(output_root, target, disease, result)
    _output(result, json_mode)
    return result


def run_package(args) -> dict:
    """Package an existing manuscript delivery into a researcher-facing ZIP."""
    json_mode = getattr(args, "json", False)
    output_root = Path(args.output)
    result = package_existing_delivery(output_root, args.target, args.disease)
    if result.get("success"):
        _write_manuscript_runtime_status(output_root, args.target, args.disease, result)
    _output(result, json_mode)
    return result


def main():
    parser = argparse.ArgumentParser(
        description="药物靶点智能研究平台",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 阶段1: 分析CDK4在乳腺癌和肺癌中的表达
  python main.py stage1 --gene CDK4 --cancers BRCA LUAD

  # 阶段2: 筛选乳腺癌相关靶点
  python main.py stage2 --disease "breast cancer"

  # 阶段3: 深度调研CDK4靶点
  python main.py stage3 --target CDK4 --disease "breast cancer"

  # 阶段4: 生成商业计划书
  python main.py stage4 --target CDK4 --disease "breast cancer"

  # 完整Pipeline（JSON输出，agent可解析）
  python main.py full --target CDK4 --disease "breast cancer" --cancers BRCA LUAD --json

  # 从已有结果生成期刊论文草稿
  python main.py manuscript --target CDK4 --disease "breast cancer" --json
        """
    )

    # 全局参数
    parser.add_argument("--json", action="store_true",
                       help="以 JSON 格式输出结果（agent 可解析）")

    subparsers = parser.add_subparsers(dest="stage", help="分析阶段")

    # 阶段1子命令
    stage1_parser = subparsers.add_parser("stage1", help="阶段1: 靶点表达全景与预后挖掘")
    stage1_parser.add_argument("--gene", required=True, help="基因符号")
    stage1_parser.add_argument("--cancers", nargs="+", required=True, help="癌种列表")
    stage1_parser.add_argument("--ensg", help="Ensembl基因ID（可选）")
    stage1_parser.add_argument("--output", default="./output/stage1", help="输出目录")
    stage1_parser.add_argument("--cache", default="./cache", help="缓存目录")
    stage1_parser.add_argument("--json", action="store_true", help="JSON格式输出")

    # 阶段2子命令
    stage2_parser = subparsers.add_parser("stage2", help="阶段2: 多维靶点筛选与优先级排序")
    stage2_parser.add_argument("--disease", required=True, help="疾病名称")
    stage2_parser.add_argument("--exclude-targets", help="排除的已知靶点（逗号分隔）")
    stage2_parser.add_argument("--top-n", type=int, default=20, help="返回前N个候选靶点")
    stage2_parser.add_argument("--output", default="./output/stage2", help="输出目录")
    stage2_parser.add_argument("--cache", default="./cache", help="缓存目录")
    stage2_parser.add_argument("--json", action="store_true", help="JSON格式输出")

    # 阶段3子命令
    stage3_parser = subparsers.add_parser("stage3", help="阶段3: 靶点深度调研与赛道格局分析")
    stage3_parser.add_argument("--target", required=True, help="靶点名称")
    stage3_parser.add_argument("--ensg", help="Ensembl基因ID（可选）")
    stage3_parser.add_argument("--disease", help="疾病名称（可选）")
    stage3_parser.add_argument("--output", default="./output/stage3", help="输出目录")
    stage3_parser.add_argument("--cache", default="./cache", help="缓存目录")
    stage3_parser.add_argument("--json", action="store_true", help="JSON格式输出")

    # 阶段4子命令
    stage4_parser = subparsers.add_parser("stage4", help="阶段4: 商业计划书与里程碑规划")
    stage4_parser.add_argument("--target", required=True, help="靶点名称")
    stage4_parser.add_argument("--disease", help="疾病名称（可选）")
    stage4_parser.add_argument("--modality", default="small_molecule",
                              choices=["small_molecule", "antibody", "cell_therapy", "gene_therapy"],
                              help="药物形式")
    stage4_parser.add_argument("--risk-level", default="medium",
                              choices=["low", "medium", "high"],
                              help="风险等级")
    stage4_parser.add_argument("--output", default="./output/stage4", help="输出目录")
    stage4_parser.add_argument("--cache", default="./cache", help="缓存目录")
    stage4_parser.add_argument("--json", action="store_true", help="JSON格式输出")

    # 完整Pipeline子命令
    full_parser = subparsers.add_parser("full", help="完整Pipeline: 从表达到商业计划")
    full_parser.add_argument("--target", required=True, help="靶点名称")
    full_parser.add_argument("--disease", required=True, help="疾病名称")
    full_parser.add_argument("--cancers", nargs="+", help="癌种列表")
    full_parser.add_argument("--ensg", help="Ensembl基因ID（可选）")
    full_parser.add_argument("--modality", default="small_molecule",
                            choices=["small_molecule", "antibody", "cell_therapy", "gene_therapy"],
                            help="药物形式")
    full_parser.add_argument("--risk-level", default="medium",
                            choices=["low", "medium", "high"],
                            help="风险等级")
    full_parser.add_argument("--output", default="./output", help="输出目录")
    full_parser.add_argument("--cache", default="./cache", help="缓存目录")
    full_parser.add_argument("--json", action="store_true", help="JSON格式输出")

    manuscript_parser = subparsers.add_parser(
        "manuscript", help="生成期刊论文草稿（IMRaD，基于已有四阶段结果）"
    )
    manuscript_parser.add_argument("--target", required=True, help="靶点名称")
    manuscript_parser.add_argument("--disease", required=True, help="疾病名称")
    manuscript_parser.add_argument("--output", default="./output", help="管线输出根目录")
    manuscript_parser.add_argument("--fail-on-quality", action="store_true", help="质量门禁失败时返回非零退出码")
    manuscript_parser.add_argument("--json", action="store_true", help="JSON格式输出")

    package_parser = subparsers.add_parser(
        "package", help="打包已有论文交付物（manifest + ZIP）"
    )
    package_parser.add_argument("--target", required=True, help="靶点名称")
    package_parser.add_argument("--disease", required=True, help="疾病名称")
    package_parser.add_argument("--output", default="./output", help="管线输出根目录")
    package_parser.add_argument("--json", action="store_true", help="JSON格式输出")

    args = parser.parse_args()

    if not args.stage:
        parser.print_help()
        sys.exit(1)

    result = None
    if args.stage == "stage1":
        result = run_stage1(args)
    elif args.stage == "stage2":
        result = run_stage2(args)
    elif args.stage == "stage3":
        result = run_stage3(args)
    elif args.stage == "stage4":
        result = run_stage4(args)
    elif args.stage == "full":
        result = run_full_pipeline(args)
    elif args.stage == "manuscript":
        result = run_manuscript(args)
    elif args.stage == "package":
        result = run_package(args)

    # 设置退出码
    if result and not result.get("success"):
        sys.exit(1)


if __name__ == "__main__":
    _ensure_utf8_stdio()
    main()
