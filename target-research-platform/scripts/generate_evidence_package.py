"""
证据包生成演示
使用 pipeline_output.json 生成完整的研究交付物
"""
import json
import sys
from pathlib import Path

# 添加项目根目录到 path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))


def main():
    # 加载 pipeline 输出
    json_path = project_root / "output" / "demo" / "pipeline_output.json"
    if not json_path.exists():
        print(f"Error: {json_path} not found. Run pipeline first.")
        sys.exit(1)

    with open(json_path, encoding="utf-8") as f:
        pipeline_results = json.load(f)

    gene = pipeline_results.get("target", "EGFR")
    disease = pipeline_results.get("disease", "lung cancer")

    # 生成证据包
    from src.output import EvidencePackage

    output_dir = project_root / "output" / f"evidence_{gene}_{disease.replace(' ', '_')}"
    pkg = EvidencePackage(str(output_dir), dpi=150)

    print(f"Generating evidence package for {gene} — {disease}...")
    print(f"Output directory: {output_dir}\n")

    manifest = pkg.generate(pipeline_results, gene, disease)

    # 打印结果摘要
    print("=" * 60)
    print("Evidence Package Generated Successfully")
    print("=" * 60)
    print(f"\nGene: {manifest['gene']}")
    print(f"Disease: {manifest['disease']}")
    print(f"Generated: {manifest['generated_at']}")

    files = manifest.get("files", {})
    print(f"\n--- Reports ---")
    for key in ["html_report", "pdf_report", "docx_report"]:
        val = files.get(key, "")
        if val and not str(val).startswith("Error"):
            print(f"  {key}: {Path(val).name}")
        elif str(val).startswith("Error"):
            print(f"  {key}: {val}")

    print(f"\n--- Data ---")
    if files.get("json"):
        print(f"  JSON: {Path(files['json']).name}")
    csv_files = files.get("csv", {})
    for name, path in csv_files.items():
        if path:
            print(f"  CSV ({name}): {Path(path).name}")

    print(f"\n--- Charts ---")
    chart_files = files.get("charts", {})
    for name, path in chart_files.items():
        if path:
            print(f"  {name}: {Path(path).name}")

    print(f"\nManifest: {output_dir / 'manifest.json'}")
    print(f"README: {output_dir / 'README.md'}")
    print(f"\nOpen report.html in browser to view the report.")


if __name__ == "__main__":
    main()
