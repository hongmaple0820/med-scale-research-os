"""
数据导出器
将研究数据导出为 CSV/TSV 格式，支持溯源
"""
import csv
import json
from pathlib import Path
from typing import Optional
from datetime import datetime


class DataExporter:
    """导出研究数据为可下载的表格格式"""

    def __init__(self, output_dir: str):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def _write_csv(self, rows: list[dict], filename: str, delimiter: str = ",") -> str:
        """写入 CSV/TSV 文件"""
        if not rows:
            return ""
        path = self.output_dir / filename
        with open(path, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.DictWriter(f, fieldnames=rows[0].keys(), delimiter=delimiter)
            writer.writeheader()
            writer.writerows(rows)
        return str(path)

    def export_tissue_expression(
        self,
        tissues: dict[str, float],
        gene_symbol: str,
        source: str = "GTEx"
    ) -> dict:
        """导出组织表达数据"""
        rows = [
            {"rank": i +  1, "tissue": name, "tpm": round(val, 2), "gene": gene_symbol, "source": source}
            for i, (name, val) in enumerate(
                sorted(tissues.items(), key=lambda x: x[1], reverse=True)
            )
        ]
        csv_path = self._write_csv(rows, f"tissue_expression_{gene_symbol}.csv")
        tsv_path = self._write_csv(rows, f"tissue_expression_{gene_symbol}.tsv", delimiter="\t")
        return {"csv": csv_path, "tsv": tsv_path, "row_count": len(rows)}

    def export_survival_data(
        self,
        survival_results: dict,
        gene_symbol: str
    ) -> dict:
        """导出生存分析数据"""
        rows = []
        for cancer_type, data in survival_results.items():
            rows.append({
                "gene": gene_symbol,
                "cancer_type": cancer_type,
                "median_high_months": data.get("median_high", ""),
                "median_low_months": data.get("median_low", ""),
                "hr": data.get("hr", ""),
                "hr_ci_lower": data.get("hr_ci_95", ["", ""])[0],
                "hr_ci_upper": data.get("hr_ci_95", ["", ""])[1],
                "p_value": data.get("p_value", ""),
                "log_rank_p": data.get("log_rank_p", ""),
                "n_high": data.get("n_high", ""),
                "n_low": data.get("n_low", ""),
            })
        csv_path = self._write_csv(rows, f"survival_{gene_symbol}.csv")
        return {"csv": csv_path, "row_count": len(rows)}

    def export_immune_correlation(
        self,
        correlations: dict[str, dict],
        gene_symbol: str,
        cancer_type: str
    ) -> dict:
        """导出免疫细胞相关性数据"""
        rows = []
        for cell, data in sorted(correlations.items(), key=lambda x: abs(x[1].get("correlation", 0)), reverse=True):
            pval = data.get("p_value", 1)
            rows.append({
                "gene": gene_symbol,
                "cancer_type": cancer_type,
                "immune_cell": cell,
                "correlation": round(data.get("correlation", 0), 4),
                "p_value": f"{pval:.2e}" if pval < 0.001 else round(pval, 4),
                "significant": "Yes" if pval < 0.05 else "No",
                "method": data.get("method", "Spearman"),
            })
        csv_path = self._write_csv(rows, f"immune_{gene_symbol}_{cancer_type}.csv")
        return {"csv": csv_path, "row_count": len(rows)}

    def export_de_results(
        self,
        genes: list[dict],
        disease: str,
        source: str = "GEO"
    ) -> dict:
        """导出差异表达分析结果"""
        rows = []
        for g in genes:
            pval = g.get("p_value", 1)
            adj_pval = g.get("adj_p_value", pval)
            rows.append({
                "gene": g.get("gene", ""),
                "log2fc": round(g.get("log2fc", 0), 4),
                "p_value": f"{pval:.2e}" if pval < 0.001 else round(pval, 6),
                "adj_p_value": f"{adj_pval:.2e}" if adj_pval < 0.001 else round(adj_pval, 6),
                "significant": "Yes" if abs(g.get("log2fc", 0)) > 1 and adj_pval < 0.05 else "No",
                "direction": "Up" if g.get("log2fc", 0) > 0 else "Down",
                "disease": disease,
                "source": source,
            })
        csv_path = self._write_csv(rows, f"de_results_{disease.replace(' ', '_')}.csv")
        return {"csv": csv_path, "row_count": len(rows)}

    def export_druggability(
        self,
        targets: list[dict]
    ) -> dict:
        """导出成药性评估数据"""
        rows = []
        for t in targets:
            rows.append({
                "gene": t.get("gene", ""),
                "composite_score": round(t.get("composite_score", 0), 4),
                "de_score": round(t.get("de_score", 0), 4),
                "druggability_score": round(t.get("druggability_score", 0), 4),
                "druggability_class": t.get("druggability_class", ""),
                "drug_count": t.get("drug_count", ""),
                "max_clinical_phase": t.get("max_phase", ""),
                "literature_count": t.get("literature_count", ""),
            })
        csv_path = self._write_csv(rows, "target_ranking.csv")
        return {"csv": csv_path, "row_count": len(rows)}

    def export_milestones(
        self,
        phases: list[dict],
        target_name: str
    ) -> dict:
        """导出开发里程碑数据"""
        rows = []
        cumulative = 0
        for i, p in enumerate(phases):
            duration = p.get("duration_months", 0)
            rows.append({
                "phase": p.get("name", f"Phase {i+1}"),
                "duration_months": duration,
                "start_month": cumulative,
                "end_month": cumulative + duration,
                "cost_million_usd": p.get("cost", 0),
                "success_rate": f"{p.get('success_rate', 0)*100:.0f}%",
                "cumulative_cost_million": sum(ph.get("cost", 0) for ph in phases[:i+1]),
            })
            cumulative += duration
        csv_path = self._write_csv(rows, f"milestones_{target_name}.csv")
        return {"csv": csv_path, "row_count": len(rows)}

    def export_pipeline_json(
        self,
        pipeline_results: dict,
        filename: str = "pipeline_output.json"
    ) -> str:
        """导出完整 pipeline 结果为 JSON"""
        path = self.output_dir / filename
        with open(path, "w", encoding="utf-8") as f:
            json.dump(pipeline_results, f, ensure_ascii=False, indent=2, default=str)
        return str(path)

    def export_all_stage1(
        self,
        stage_data: dict,
        gene_symbol: str
    ) -> dict:
        """导出 Stage1 全部数据"""
        exports = {}

        # 组织表达
        tissues = stage_data.get("tissue_expression", {}).get("gtex", {}).get("tissues", {})
        if tissues:
            exports["tissue_expression"] = self.export_tissue_expression(tissues, gene_symbol)

        # 生存分析
        survival = stage_data.get("survival", {})
        if survival:
            exports["survival"] = self.export_survival_data(survival, gene_symbol)

        # 免疫相关性
        immune = stage_data.get("immune", {})
        for cancer_type, corr_data in immune.items():
            if isinstance(corr_data, dict) and "correlations" in corr_data:
                exports[f"immune_{cancer_type}"] = self.export_immune_correlation(
                    corr_data["correlations"], gene_symbol, cancer_type
                )

        return exports

    def export_all_stage2(
        self,
        stage_data: dict,
        disease: str
    ) -> dict:
        """导出 Stage2 全部数据"""
        exports = {}

        de_genes = stage_data.get("differential_expression", {}).get("results", [])
        if de_genes:
            exports["de_results"] = self.export_de_results(de_genes, disease)

        targets = stage_data.get("top_targets", [])
        if targets:
            exports["druggability"] = self.export_druggability(targets)

        return exports
