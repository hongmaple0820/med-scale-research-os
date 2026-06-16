#!/usr/bin/env python3
"""
SCALE Bridge Runner — Python 端桥接入点

接收 TS 端通过 stdin 传入的 BridgeRequest JSON，
调度 target-research-platform 的 Stage Pipeline，
输出符合 BridgeResponse 协议的 JSON 到 stdout。

用法:
  # 被 TS 端自动调用，也可手动测试:
  echo '{"protocol":"scale-analysis-v1","stage":"expression","input":{"gene_symbol":"CDK4","cancer_types":["BRCA"]},"timeout_ms":300000,"output_schema":"expression_result_v1","request_id":"test-001"}' | python bridge_runner.py

  # 独立运行（等同 main.py --json）:
  python bridge_runner.py stage1 --gene CDK4 --cancers BRCA
"""
import argparse
import json
import sys
import time
import traceback
from pathlib import Path

# 添加 target-research-platform/src 到路径
PLATFORM_DIR = Path(__file__).parent
sys.path.insert(0, str(PLATFORM_DIR))

from src.analysis.stage1_expression import Stage1Pipeline
from src.analysis.stage2_screening import Stage2Pipeline
from src.analysis.stage3_deep_research import Stage3Pipeline
from src.analysis.stage4_business import Stage4Pipeline


PROTOCOL_VERSION = "scale-analysis-v1"

# Stage → Pipeline class 映射
STAGE_PIPELINE_MAP = {
    "expression": ("stage1", Stage1Pipeline),
    "screening": ("stage2", Stage2Pipeline),
    "deep_research": ("stage3", Stage3Pipeline),
    "business": ("stage4", Stage4Pipeline),
}


def _make_response(
    request_id: str,
    stage: str,
    success: bool,
    data=None,
    error: str = None,
    duration_ms: int = 0,
    provenance: list = None,
) -> dict:
    """构建标准 BridgeResponse"""
    resp = {
        "protocol": PROTOCOL_VERSION,
        "request_id": request_id,
        "success": success,
        "stage": stage,
        "duration_ms": duration_ms,
    }
    if data is not None:
        resp["data"] = data
    if error is not None:
        resp["error"] = error
    if provenance is not None:
        resp["provenance"] = provenance
    return resp


def _sanitize_for_json(obj):
    """递归转换 numpy 类型为 Python 原生类型"""
    import numpy as np
    if isinstance(obj, dict):
        return {k: _sanitize_for_json(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_sanitize_for_json(v) for v in obj]
    elif isinstance(obj, np.bool_):
        return bool(obj)
    elif isinstance(obj, np.integer):
        return int(obj)
    elif isinstance(obj, np.floating):
        return float(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    return obj


def execute_bridge_request(request: dict) -> dict:
    """
    执行桥接请求

    Args:
        request: BridgeRequest dict

    Returns:
        BridgeResponse dict
    """
    request_id = request.get("request_id", "unknown")
    stage = request.get("stage", "")
    input_data = request.get("input", {})

    # 验证协议版本
    if request.get("protocol") != PROTOCOL_VERSION:
        return _make_response(
            request_id, stage, False,
            error=f"Unsupported protocol: {request.get('protocol')}"
        )

    # 验证阶段
    if stage not in STAGE_PIPELINE_MAP:
        return _make_response(
            request_id, stage, False,
            error=f"Unknown stage: {stage}. Supported: {list(STAGE_PIPELINE_MAP.keys())}"
        )

    cli_stage, pipeline_cls = STAGE_PIPELINE_MAP[stage]

    # 执行
    start_time = time.time()
    try:
        output_dir = input_data.pop("output_dir", f"./output/{cli_stage}")
        cache_dir = input_data.pop("cache_dir", "./cache")

        pipeline = pipeline_cls(output_dir=output_dir, cache_dir=cache_dir)

        # 根据阶段调用对应参数
        if stage == "expression":
            result = pipeline.run(
                gene_symbol=input_data["gene_symbol"],
                cancer_types=input_data["cancer_types"],
                ensg_id=input_data.get("ensg_id"),
            )
        elif stage == "screening":
            result = pipeline.run(
                disease=input_data["disease"],
                known_targets=input_data.get("exclude_targets"),
                top_n=input_data.get("top_n", 20),
                normal_tissue_expression=input_data.get("normal_tissue_expression"),
            )
        elif stage == "deep_research":
            result = pipeline.run(
                target_name=input_data["target_name"],
                ensg_id=input_data.get("ensg_id"),
                disease=input_data.get("disease"),
            )
        elif stage == "business":
            result = pipeline.run(
                target_name=input_data["target_name"],
                disease=input_data.get("disease"),
                stage1_data=input_data.get("stage1_data"),
                stage2_data=input_data.get("stage2_data"),
                stage3_data=input_data.get("stage3_data"),
                modality=input_data.get("modality", "small_molecule"),
                risk_level=input_data.get("risk_level", "medium"),
            )
        else:
            return _make_response(request_id, stage, False, error=f"Unhandled stage: {stage}")

        duration_ms = int((time.time() - start_time) * 1000)

        # 清洗 numpy 类型
        result = _sanitize_for_json(result)

        # 提取溯源信息（如果有）
        provenance = None
        if hasattr(pipeline, 'provenance_tracker') and pipeline.provenance_tracker:
            provenance = pipeline.provenance_tracker.get_all_provenance()

        return _make_response(
            request_id, stage, result.get("success", True),
            data=result,
            duration_ms=duration_ms,
            provenance=provenance,
        )

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        return _make_response(
            request_id, stage, False,
            error=str(e),
            duration_ms=duration_ms,
        )


def run_from_stdin():
    """从 stdin 读取 BridgeRequest JSON 并执行"""
    try:
        raw_input = sys.stdin.read().strip()
        if not raw_input:
            print(json.dumps({
                "protocol": PROTOCOL_VERSION,
                "request_id": "stdin",
                "success": False,
                "error": "No input received on stdin",
                "stage": "",
                "duration_ms": 0,
            }), flush=True)
            return

        request = json.loads(raw_input)
        response = execute_bridge_request(request)

        # 输出到 stdout（TS 端从 stdout 读取）
        print(json.dumps(response, ensure_ascii=False, default=str), flush=True)

    except json.JSONDecodeError as e:
        print(json.dumps({
            "protocol": PROTOCOL_VERSION,
            "request_id": "stdin",
            "success": False,
            "error": f"Invalid JSON input: {e}",
            "stage": "",
            "duration_ms": 0,
        }), flush=True)
    except Exception as e:
        print(json.dumps({
            "protocol": PROTOCOL_VERSION,
            "request_id": "stdin",
            "success": False,
            "error": f"Unexpected error: {e}",
            "error_details": {
                "type": type(e).__name__,
                "message": str(e),
                "traceback": traceback.format_exc(),
            },
            "stage": "",
            "duration_ms": 0,
        }), flush=True)


def run_from_cli():
    """通过命令行参数运行（兼容 main.py 接口）"""
    parser = argparse.ArgumentParser(description="SCALE Bridge Runner")
    parser.add_argument("stage", choices=["stage1", "stage2", "stage3", "stage4", "stdin"],
                       help="分析阶段或 'stdin' 模式")
    parser.add_argument("--gene", help="基因符号 (stage1)")
    parser.add_argument("--cancers", nargs="+", help="癌种列表 (stage1)")
    parser.add_argument("--disease", help="疾病名称 (stage2/3/4)")
    parser.add_argument("--target", help="靶点名称 (stage3/4)")
    parser.add_argument("--ensg", help="Ensembl基因ID")
    parser.add_argument("--output", default="./output", help="输出目录")
    parser.add_argument("--cache", default="./cache", help="缓存目录")
    parser.add_argument("--json", action="store_true", help="JSON格式输出")

    args = parser.parse_args()

    if args.stage == "stdin":
        run_from_stdin()
        return

    # 构建桥接请求
    stage_map = {
        "stage1": "expression",
        "stage2": "screening",
        "stage3": "deep_research",
        "stage4": "business",
    }
    stage = stage_map[args.stage]

    input_data = {"output_dir": args.output, "cache_dir": args.cache}
    if stage == "expression":
        input_data["gene_symbol"] = args.gene
        input_data["cancer_types"] = args.cancers or []
        if args.ensg:
            input_data["ensg_id"] = args.ensg
    elif stage == "screening":
        input_data["disease"] = args.disease
    elif stage == "deep_research":
        input_data["target_name"] = args.target
        if args.ensg:
            input_data["ensg_id"] = args.ensg
        if args.disease:
            input_data["disease"] = args.disease
    elif stage == "business":
        input_data["target_name"] = args.target
        if args.disease:
            input_data["disease"] = args.disease

    request = {
        "protocol": PROTOCOL_VERSION,
        "stage": stage,
        "input": input_data,
        "timeout_ms": 300000,
        "output_schema": f"{stage}_result_v1",
        "request_id": f"cli-{int(time.time())}",
    }

    response = execute_bridge_request(request)

    if args.json:
        print(json.dumps(response, ensure_ascii=False, default=str, indent=2))
    else:
        if response["success"]:
            print(f"✓ Stage {stage} completed in {response['duration_ms']}ms")
            if response.get("data"):
                data = response["data"]
                summary = data.get("summary", {})
                print(f"  Gene: {summary.get('gene', 'N/A')}")
                print(f"  Findings: {len(summary.get('key_findings', []))}")
        else:
            print(f"✗ Stage {stage} failed: {response.get('error', 'Unknown error')}")
            sys.exit(1)


if __name__ == "__main__":
    # 如果有 stdin 数据且无命令行参数，使用 stdin 模式
    if not sys.stdin.isatty() and len(sys.argv) == 1:
        run_from_stdin()
    else:
        run_from_cli()
