"""
证据包生成器
将所有输出打包为完整的研究交付物
"""
import json
import shutil
from pathlib import Path
from datetime import datetime
from typing import Optional

from .chart_generator import ChartGenerator
from .data_exporter import DataExporter
from .report_generator import ReportGenerator


class EvidencePackage:
    """
    生成完整的研究证据包

    结构:
    output/{gene}_{disease}/
    ├── charts/              # PNG/SVG 图表
    ├── data/                # CSV/TSV 原始数据
    ├── report.html          # HTML 报告
    ├── report.pdf           # PDF 报告
    ├── report.docx          # DOCX 报告
    ├── pipeline_output.json # 完整 JSON 结果
    ├── manifest.json        # 包清单（含溯源）
    └── README.md            # 使用说明
    """

    def __init__(self, output_dir: str, dpi: int = 150):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.dpi = dpi

        self.charts_dir = self.output_dir / "charts"
        self.data_dir = self.output_dir / "data"

        self.chart_gen = ChartGenerator(str(self.charts_dir), dpi=dpi)
        self.data_exp = DataExporter(str(self.data_dir))
        self.report_gen = ReportGenerator(str(self.output_dir))

    def generate(
        self,
        pipeline_results: dict,
        gene_symbol: str,
        disease: str,
        title: str = None,
    ) -> dict:
        """
        生成完整证据包

        Args:
            pipeline_results: pipeline 输出的完整结果字典
            gene_symbol: 基因符号
            disease: 疾病名称
            title: 报告标题

        Returns:
            包含所有生成文件路径的字典
        """
        manifest = {
            "gene": gene_symbol,
            "disease": disease,
            "generated_at": datetime.now().isoformat(),
            "pipeline_version": "1.0",
            "files": {},
        }

        stages = pipeline_results.get("stages", pipeline_results)

        # === 1. 导出 JSON ===
        json_path = self.data_exp.export_pipeline_json(pipeline_results, "pipeline_output.json")
        manifest["files"]["json"] = json_path

        # === 2. 导出 CSV 数据 ===
        csv_exports = {}
        s1 = stages.get("stage1", {})
        s1_summary = s1.get("summary", s1)
        if s1_summary:
            csv_exports.update(self.data_exp.export_all_stage1(s1_summary, gene_symbol))

        s2 = stages.get("stage2", {})
        s2_summary = s2.get("summary", s2)
        if s2_summary:
            csv_exports.update(self.data_exp.export_all_stage2(s2_summary, disease))

        s4 = stages.get("stage4", {}).get("summary", {})
        milestones = s4.get("milestones", {})
        if milestones and "phases" in milestones:
            csv_exports["milestones"] = self.data_exp.export_milestones(
                milestones["phases"], gene_symbol
            )

        manifest["files"]["csv"] = {k: v.get("csv", "") for k, v in csv_exports.items() if isinstance(v, dict)}

        # === 3. 生成图表 ===
        chart_files = {}

        # Stage1: 组织表达
        tissues = s1_summary.get("tissue_expression", {}).get("gtex", {}).get("tissues", {})
        if tissues:
            chart_files["tissue_expression"] = self.chart_gen.tissue_expression_bar(
                tissues, gene_symbol
            )

        # Stage1: 免疫相关性
        immune = s1_summary.get("immune", {})
        for cancer_type, corr_data in immune.items():
            if isinstance(corr_data, dict) and "correlations" in corr_data:
                chart_files[f"immune_{cancer_type}"] = self.chart_gen.immune_correlation_heatmap(
                    corr_data["correlations"], gene_symbol, cancer_type
                )

        # Stage2: 综合排名
        targets = s2_summary.get("top_targets", [])
        if targets:
            chart_files["composite_ranking"] = self.chart_gen.composite_ranking_bar(targets)

        # Stage2: 火山图
        de_results = s2_summary.get("differential_expression", {}).get("results", [])
        if de_results:
            chart_files["volcano"] = self.chart_gen.volcano_plot(de_results, gene_symbol)

        # Stage3: 成药性雷达
        if targets:
            chart_files["druggability_radar"] = self.chart_gen.druggability_radar(targets)

        # Stage4: 里程碑
        phases = s4.get("phases", milestones.get("phases", []))
        if phases:
            chart_files["milestones"] = self.chart_gen.milestone_gantt(phases, gene_symbol)

        manifest["files"]["charts"] = {k: v.get("png", "") for k, v in chart_files.items() if isinstance(v, dict)}

        # === 4. 生成 HTML 报告 ===
        html_path = self.report_gen.generate_html(
            pipeline_results, gene_symbol, disease, title=title,
        )
        manifest["files"]["html_report"] = html_path

        # === 5. 生成 PDF ===
        try:
            pdf_path = self.report_gen.generate_pdf(html_path)
            manifest["files"]["pdf_report"] = pdf_path
        except Exception as e:
            manifest["files"]["pdf_report"] = f"Error: {e}"

        # === 6. 生成 DOCX ===
        try:
            docx_path = self.report_gen.generate_docx(
                pipeline_results, gene_symbol, disease, title=title
            )
            manifest["files"]["docx_report"] = docx_path
        except Exception as e:
            manifest["files"]["docx_report"] = f"Error: {e}"

        # === 7. 写入 manifest ===
        manifest_path = self.output_dir / "manifest.json"
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2, default=str)

        # === 8. 生成 README ===
        self._generate_readme(gene_symbol, disease, manifest)

        return manifest

    def _generate_readme(self, gene_symbol: str, disease: str, manifest: dict):
        """生成包说明文件"""
        lines = [
            f"# {gene_symbol} — {disease} 研究证据包",
            "",
            f"生成时间: {manifest['generated_at']}",
            f"Pipeline 版本: {manifest['pipeline_version']}",
            "",
            "## 文件清单",
            "",
            "| 类型 | 文件 | 说明 |",
            "|------|------|------|",
        ]

        files = manifest.get("files", {})
        if files.get("html_report"):
            lines.append(f"| HTML 报告 | `{Path(files['html_report']).name}` | 可交互网页报告 |")
        if files.get("pdf_report") and not str(files.get("pdf_report", "")).startswith("Error"):
            lines.append(f"| PDF 报告 | `{Path(files['pdf_report']).name}` | 可打印/存档 PDF |")
        if files.get("docx_report") and not str(files.get("docx_report", "")).startswith("Error"):
            lines.append(f"| DOCX 报告 | `{Path(files['docx_report']).name}` | 可编辑 Word 文档 |")
        if files.get("json"):
            lines.append(f"| JSON 数据 | `{Path(files['json']).name}` | 完整结构化结果 |")

        csv_files = files.get("csv", {})
        for name, path in csv_files.items():
            if path:
                lines.append(f"| CSV 数据 | `data/{Path(path).name}` | {name} 原始数据 |")

        chart_files = files.get("charts", {})
        for name, path in chart_files.items():
            if path:
                lines.append(f"| 图表 | `charts/{Path(path).name}` | {name} 图表 (PNG) |")

        lines.extend([
            "",
            "## 数据溯源",
            "",
            "| 数据源 | 版本 | 用途 |",
            "|--------|------|------|",
            "| GTEx | v8 | 正常组织表达 |",
            "| TCGA/GDC | 2024 | 肿瘤表达与生存分析 |",
            "| GEO | 2024 | 差异表达分析 |",
            "| OpenTargets | 2024.02 | 靶点-疾病关联 |",
            "",
            "## 使用说明",
            "",
            "1. 用浏览器打开 `report.html` 查看可视化报告",
            "2. `report.pdf` 可直接打印或提交",
            "3. `report.docx` 可编辑后纳入正式文档",
            "4. `data/` 目录包含所有原始数据 (CSV)，可导入 Excel/R/Python",
            "5. `charts/` 目录包含出版级图表 (PNG/SVG)",
            "6. `pipeline_output.json` 包含完整结构化结果，可供 agent 解析",
            "",
            "## 引用",
            "",
            "本报告由药物靶点智能研究平台自动生成。",
            "数据来源: GTEx, TCGA/GDC, GEO, OpenTargets, PubMed, ClinicalTrials.gov",
        ])

        readme_path = self.output_dir / "README.md"
        readme_path.write_text("\n".join(lines), encoding="utf-8")
