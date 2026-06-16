#!/usr/bin/env python3
"""
演示报告生成器
模拟完整 pipeline 运行，生成 HTML 可视化报告
"""
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import numpy as np
import pandas as pd
from unittest.mock import MagicMock, patch

from src.api_clients.base_client import APIResponse as AR


def make_demo_data():
    """构造演示数据"""

    # === Stage1 数据 ===
    tissues = {
        "Brain": 15.2, "Lung": 8.3, "Liver": 3.1, "Kidney": 5.7,
        "Heart": 2.4, "Stomach": 6.8, "Colon": 4.2, "Breast": 7.9,
        "Prostate": 3.5, "Pancreas": 2.8, "Skin": 4.6, "Muscle": 1.2,
        "Adipose": 2.1, "Ovary": 5.3, "Testis": 3.8, "Thyroid": 9.1,
        "Adrenal": 4.4, "Bladder": 6.2, "Esophagus": 5.5, "Nerve": 12.8,
        "Pituitary": 7.3, "Salivary": 4.1, "Spleen": 3.6, "Thymus": 6.9,
        "Uterus": 5.1, "Vagina": 4.8, "Lymph": 3.2, "Bone": 2.9,
    }

    survival_data = {
        "LUAD": {
            "km_analysis": {"high_group": {"median_survival": 28.5}, "low_group": {"median_survival": 45.2}},
            "logrank_test": {"statistic": 6.82, "p_value": 0.009},
            "cox_regression": {"hr": 1.72, "ci_lower": 1.15, "ci_upper": 2.57, "p_value": 0.008}
        },
        "BRCA": {
            "km_analysis": {"high_group": {"median_survival": 72.1}, "low_group": {"median_survival": 89.3}},
            "logrank_test": {"statistic": 3.45, "p_value": 0.063},
            "cox_regression": {"hr": 1.31, "ci_lower": 0.98, "ci_upper": 1.75, "p_value": 0.068}
        }
    }

    immune_correlations = {
        "LUAD": {
            "sample_count": 200,
            "correlations": {
                "B_cell": {"correlation": 0.18, "p_value": 0.011, "significant": True, "strength": "weak", "direction": "positive"},
                "CD4_T_cell": {"correlation": 0.05, "p_value": 0.48, "significant": False, "strength": "negligible", "direction": "positive"},
                "CD8_T_cell": {"correlation": -0.32, "p_value": 0.0001, "significant": True, "strength": "moderate", "direction": "negative"},
                "Neutrophil": {"correlation": 0.08, "p_value": 0.26, "significant": False, "strength": "negligible", "direction": "positive"},
                "Macrophage": {"correlation": -0.28, "p_value": 0.0003, "significant": True, "strength": "weak", "direction": "negative"},
                "Dendritic_cell": {"correlation": -0.12, "p_value": 0.09, "significant": False, "strength": "weak", "direction": "negative"},
                "NK_cell": {"correlation": -0.15, "p_value": 0.035, "significant": True, "strength": "weak", "direction": "negative"},
                "Monocyte": {"correlation": 0.06, "p_value": 0.40, "significant": False, "strength": "negligible", "direction": "positive"},
                "Mast_cell": {"correlation": 0.03, "p_value": 0.67, "significant": False, "strength": "negligible", "direction": "positive"},
                "Eosinophil": {"correlation": -0.04, "p_value": 0.57, "significant": False, "strength": "negligible", "direction": "negative"},
            },
            "summary": {
                "significant_count": 4,
                "significant_cells": ["B_cell", "CD8_T_cell", "Macrophage", "NK_cell"],
                "positive_correlations": ["B_cell"],
                "negative_correlations": ["CD8_T_cell", "Macrophage", "NK_cell"],
            }
        }
    }

    # === Stage2 数据 ===
    de_genes = [
        {"gene": "EGFR", "log2fc": 2.85, "p_value": 1.2e-12, "adjusted_p_value": 3.5e-10},
        {"gene": "KRAS", "log2fc": 1.92, "p_value": 4.8e-9, "adjusted_p_value": 7.1e-7},
        {"gene": "MET", "log2fc": 1.67, "p_value": 2.3e-7, "adjusted_p_value": 2.2e-5},
        {"gene": "ALK", "log2fc": 1.45, "p_value": 8.1e-6, "adjusted_p_value": 5.9e-4},
        {"gene": "ROS1", "log2fc": 1.23, "p_value": 3.2e-5, "adjusted_p_value": 1.8e-3},
    ]

    ranking = [
        {"gene": "EGFR", "composite_score": 0.89, "de_score": 0.57, "druggability_score": 0.95, "druggability_class": "Tchem"},
        {"gene": "KRAS", "composite_score": 0.72, "de_score": 0.38, "druggability_score": 0.82, "druggability_class": "Tchem"},
        {"gene": "MET", "composite_score": 0.65, "de_score": 0.33, "druggability_score": 0.78, "druggability_class": "Tchem"},
        {"gene": "ALK", "composite_score": 0.58, "de_score": 0.29, "druggability_score": 0.71, "druggability_class": "Tchem"},
        {"gene": "ROS1", "composite_score": 0.51, "de_score": 0.25, "druggability_score": 0.62, "druggability_class": "Tbio"},
    ]

    # === Stage3 数据 ===
    stage3 = {
        "target_function": {"druggability": {"unique_drugs": 156, "drugs": [{"max_phase": 4}]}},
        "clinical_pipeline": {"total_trials": 487, "active_trials": 123},
        "literature": {"total_count": 28500, "pmids": ["12345", "67890"]},
    }

    # === Stage4 数据 ===
    milestones = {
        "total_duration_months": 54,
        "total_cost_estimate": 180.5,
        "overall_success_rate": 0.15,
        "phases": [
            {"name": "靶点验证", "duration_months": 12, "cost": 5.0, "success_rate": 0.60},
            {"name": "先导化合物优化", "duration_months": 18, "cost": 25.0, "success_rate": 0.45},
            {"name": "临床前研究", "duration_months": 12, "cost": 30.0, "success_rate": 0.55},
            {"name": "I期临床", "duration_months": 18, "cost": 35.0, "success_rate": 0.65},
            {"name": "II期临床", "duration_months": 24, "cost": 50.0, "success_rate": 0.35},
            {"name": "III期临床", "duration_months": 36, "cost": 80.0, "success_rate": 0.55},
        ]
    }

    return {
        "stage1": {"tissues": tissues, "survival": survival_data, "immune": immune_correlations},
        "stage2": {"de_genes": de_genes, "ranking": ranking},
        "stage3": stage3,
        "stage4": {"milestones": milestones},
    }


def generate_html_report(data: dict, output_path: Path):
    """生成 HTML 报告"""
    now = datetime.now().strftime("%Y-%m-%d %H:%M")

    # 免疫相关性表格
    immune_rows = ""
    for cell, info in data["stage1"]["immune"]["LUAD"]["correlations"].items():
        sig_class = "sig" if info["significant"] else ""
        direction = "↑" if info["direction"] == "positive" else "↓"
        immune_rows += f"""
        <tr class="{sig_class}">
            <td>{cell}</td>
            <td>{info['correlation']:+.3f} {direction}</td>
            <td>{info['p_value']:.2e}</td>
            <td>{info['strength']}</td>
            <td>{"✓" if info["significant"] else "—"}</td>
        </tr>"""

    # 生存分析表格
    survival_rows = ""
    for cancer, sdata in data["stage1"]["survival"].items():
        lr = sdata["logrank_test"]
        cox = sdata["cox_regression"]
        sig = "sig" if lr["p_value"] < 0.05 else ""
        survival_rows += f"""
        <tr class="{sig}">
            <td>{cancer}</td>
            <td>{sdata["km_analysis"]["high_group"]["median_survival"]:.1f}</td>
            <td>{sdata["km_analysis"]["low_group"]["median_survival"]:.1f}</td>
            <td>{cox["hr"]:.2f} ({cox["ci_lower"]:.2f}-{cox["ci_upper"]:.2f})</td>
            <td>{lr["p_value"]:.4f}</td>
        </tr>"""

    # DE 基因表格
    de_rows = ""
    for g in data["stage2"]["de_genes"]:
        de_rows += f"""
        <tr>
            <td><strong>{g["gene"]}</strong></td>
            <td>{g["log2fc"]:+.2f}</td>
            <td>{g["p_value"]:.2e}</td>
            <td>{g["adjusted_p_value"]:.2e}</td>
        </tr>"""

    # 排名表格
    rank_rows = ""
    for i, r in enumerate(data["stage2"]["ranking"], 1):
        bar_w = int(r["composite_score"] * 200)
        rank_rows += f"""
        <tr>
            <td>{i}</td>
            <td><strong>{r["gene"]}</strong></td>
            <td>
                <div class="bar-container">
                    <div class="bar" style="width:{bar_w}px"></div>
                    <span>{r["composite_score"]:.2f}</span>
                </div>
            </td>
            <td>{r["de_score"]:.2f}</td>
            <td>{r["druggability_score"]:.2f}</td>
            <td><span class="badge {r["druggability_class"].lower()}">{r["druggability_class"]}</span></td>
        </tr>"""

    # 里程碑甘特图
    phase_bars = ""
    colors = ["#4CAF50", "#2196F3", "#FF9800", "#9C27B0", "#F44336", "#00BCD4"]
    cumulative = 0
    for i, phase in enumerate(data["stage4"]["milestones"]["phases"]):
        w = phase["duration_months"] * 3
        sr = int(phase["success_rate"] * 100)
        phase_bars += f"""
        <div class="phase-row">
            <div class="phase-name">{phase["name"]}</div>
            <div class="phase-bar" style="width:{w}px;background:{colors[i % len(colors)]}">
                {phase["duration_months"]}月 | ${phase["cost"]}M | {sr}%
            </div>
        </div>"""
        cumulative += phase["duration_months"]

    # 组织表达 top10
    sorted_tissues = sorted(data["stage1"]["tissues"].items(), key=lambda x: x[1], reverse=True)[:10]
    tissue_bars = ""
    max_val = sorted_tissues[0][1]
    for tissue, val in sorted_tissues:
        w = int(val / max_val * 300)
        color = "#e74c3c" if val > 10 else "#3498db" if val > 5 else "#95a5a6"
        tissue_bars += f"""
        <div class="tissue-row">
            <div class="tissue-name">{tissue}</div>
            <div class="tissue-bar" style="width:{w}px;background:{color}">{val:.1f} TPM</div>
        </div>"""

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>EGFR 靶点研究报告 — 肺癌</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{ font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; background: #f5f7fa; color: #2c3e50; line-height: 1.6; }}
        .container {{ max-width: 1200px; margin: 0 auto; padding: 20px; }}
        .header {{ background: linear-gradient(135deg, #1a5276, #2980b9); color: white; padding: 40px; border-radius: 12px; margin-bottom: 24px; }}
        .header h1 {{ font-size: 28px; margin-bottom: 8px; }}
        .header .meta {{ opacity: 0.85; font-size: 14px; }}
        .grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }}
        .card {{ background: white; border-radius: 10px; padding: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }}
        .card.full {{ grid-column: 1 / -1; }}
        .card h2 {{ font-size: 18px; color: #1a5276; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid #eee; }}
        .card h3 {{ font-size: 15px; color: #555; margin: 12px 0 8px; }}
        table {{ width: 100%; border-collapse: collapse; font-size: 14px; }}
        th {{ background: #f8f9fa; text-align: left; padding: 10px 12px; font-weight: 600; color: #555; }}
        td {{ padding: 8px 12px; border-bottom: 1px solid #eee; }}
        tr.sig td {{ background: #fff8e1; }}
        tr:hover td {{ background: #f0f7ff; }}
        .badge {{ padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }}
        .badge.tchem {{ background: #e8f5e9; color: #2e7d32; }}
        .badge.tbio {{ background: #fff3e0; color: #e65100; }}
        .badge.tclin {{ background: #e3f2fd; color: #1565c0; }}
        .bar-container {{ display: flex; align-items: center; gap: 8px; }}
        .bar {{ height: 20px; background: linear-gradient(90deg, #2980b9, #3498db); border-radius: 4px; min-width: 4px; }}
        .kpi {{ display: flex; gap: 16px; flex-wrap: wrap; }}
        .kpi-item {{ flex: 1; min-width: 120px; text-align: center; padding: 16px; background: #f8f9fa; border-radius: 8px; }}
        .kpi-value {{ font-size: 28px; font-weight: 700; color: #1a5276; }}
        .kpi-label {{ font-size: 12px; color: #888; margin-top: 4px; }}
        .phase-row {{ display: flex; align-items: center; margin-bottom: 6px; }}
        .phase-name {{ width: 130px; font-size: 13px; color: #555; flex-shrink: 0; }}
        .phase-bar {{ height: 28px; border-radius: 4px; color: white; font-size: 12px; display: flex; align-items: center; padding: 0 8px; white-space: nowrap; }}
        .tissue-row {{ display: flex; align-items: center; margin-bottom: 4px; }}
        .tissue-name {{ width: 80px; font-size: 13px; color: #555; flex-shrink: 0; }}
        .tissue-bar {{ height: 24px; border-radius: 4px; color: white; font-size: 12px; display: flex; align-items: center; padding: 0 8px; }}
        .summary-box {{ background: #e8f5e9; border-left: 4px solid #4CAF50; padding: 16px; border-radius: 0 8px 8px 0; margin-top: 12px; }}
        .warning-box {{ background: #fff3e0; border-left: 4px solid #FF9800; padding: 16px; border-radius: 0 8px 8px 0; margin-top: 12px; }}
        .footer {{ text-align: center; color: #aaa; font-size: 12px; margin-top: 32px; padding: 16px; }}
        .stage-tag {{ display: inline-block; background: #2980b9; color: white; padding: 2px 10px; border-radius: 12px; font-size: 12px; margin-bottom: 8px; }}
        .stage-tag.s1 {{ background: #27ae60; }}
        .stage-tag.s2 {{ background: #8e44ad; }}
        .stage-tag.s3 {{ background: #e67e22; }}
        .stage-tag.s4 {{ background: #c0392b; }}
        @media (max-width: 768px) {{ .grid {{ grid-template-columns: 1fr; }} }}
    </style>
</head>
<body>
<div class="container">

    <div class="header">
        <h1>EGFR — 非小细胞肺癌 (LUAD) 靶点研究报告</h1>
        <div class="meta">生成时间: {now} &nbsp;|&nbsp; 数据来源: GTEx, TCGA/GDC, GEO, OpenTargets, PubMed &nbsp;|&nbsp; Pipeline: drug-target-research-platform v1.0</div>
    </div>

    <!-- KPI 概览 -->
    <div class="card full">
        <div class="kpi">
            <div class="kpi-item"><div class="kpi-value">28</div><div class="kpi-label">正常组织数据</div></div>
            <div class="kpi-item"><div class="kpi-value">487</div><div class="kpi-label">临床试验</div></div>
            <div class="kpi-item"><div class="kpi-value">156</div><div class="kpi-label">已知药物</div></div>
            <div class="kpi-item"><div class="kpi-value">28.5K</div><div class="kpi-label">文献数量</div></div>
            <div class="kpi-item"><div class="kpi-value">0.89</div><div class="kpi-label">综合评分</div></div>
            <div class="kpi-item"><div class="kpi-value">15%</div><div class="kpi-label">成功率</div></div>
        </div>
    </div>

    <div class="grid">
        <!-- Stage1: 组织表达 -->
        <div class="card">
            <span class="stage-tag s1">Stage 1</span>
            <h2>正常组织表达 (GTEx)</h2>
            {tissue_bars}
            <div class="warning-box" style="margin-top:12px">
                <strong>注意:</strong> EGFR 在 Brain (15.2 TPM) 和 Nerve (12.8 TPM) 高表达，需关注 CNS 脱靶风险。
            </div>
        </div>

        <!-- Stage1: 免疫相关性 -->
        <div class="card">
            <span class="stage-tag s1">Stage 1</span>
            <h2>免疫微环境相关性 (LUAD)</h2>
            <table>
                <tr><th>免疫细胞</th><th>相关系数</th><th>p 值</th><th>强度</th><th>显著</th></tr>
                {immune_rows}
            </table>
            <div class="summary-box">
                EGFR 表达与 <strong>CD8+ T 细胞</strong> (r=-0.32) 和 <strong>巨噬细胞</strong> (r=-0.28) 呈显著负相关，
                提示 EGFR 高表达肿瘤可能具有免疫抑制微环境。
            </div>
        </div>

        <!-- Stage1: 生存分析 -->
        <div class="card">
            <span class="stage-tag s1">Stage 1</span>
            <h2>生存预后分析</h2>
            <table>
                <tr><th>癌种</th><th>高表达中位生存(月)</th><th>低表达中位生存(月)</th><th>HR (95%CI)</th><th>p 值</th></tr>
                {survival_rows}
            </table>
            <div class="summary-box">
                EGFR 高表达在 LUAD 中与较差预后显著相关 (HR=1.72, p=0.008)，在 BRCA 中未达统计学显著。
            </div>
        </div>

        <!-- Stage2: DE 基因 -->
        <div class="card">
            <span class="stage-tag s2">Stage 2</span>
            <h2>差异表达分析 (GEO)</h2>
            <table>
                <tr><th>基因</th><th>log2FC</th><th>p 值</th><th>adj. p 值</th></tr>
                {de_rows}
            </table>
        </div>

        <!-- Stage2: 排名 -->
        <div class="card full">
            <span class="stage-tag s2">Stage 2</span>
            <h2>候选靶点综合排名 (DE×0.6 + 成药性×0.4)</h2>
            <table>
                <tr><th>#</th><th>靶点</th><th>综合评分</th><th>DE 评分</th><th>成药性评分</th><th>成药性等级</th></tr>
                {rank_rows}
            </table>
        </div>

        <!-- Stage3: 赛道格局 -->
        <div class="card">
            <span class="stage-tag s3">Stage 3</span>
            <h2>赛道格局</h2>
            <div class="kpi">
                <div class="kpi-item"><div class="kpi-value">487</div><div class="kpi-label">临床试验总数</div></div>
                <div class="kpi-item"><div class="kpi-value">123</div><div class="kpi-label">进行中</div></div>
                <div class="kpi-item"><div class="kpi-value">156</div><div class="kpi-label">已知药物</div></div>
                <div class="kpi-item"><div class="kpi-value">Phase 4</div><div class="kpi-label">最高临床阶段</div></div>
            </div>
            <div class="warning-box">
                EGFR 是成熟靶点，竞争激烈。建议关注 <strong>耐药突变</strong> (C797S, T790M) 和 <strong>联合用药</strong> 策略差异化。
            </div>
        </div>

        <!-- Stage4: 里程碑 -->
        <div class="card">
            <span class="stage-tag s4">Stage 4</span>
            <h2>开发里程碑</h2>
            {phase_bars}
            <div class="kpi" style="margin-top:16px">
                <div class="kpi-item"><div class="kpi-value">{data["stage4"]["milestones"]["total_duration_months"]}</div><div class="kpi-label">总时长(月)</div></div>
                <div class="kpi-item"><div class="kpi-value">${data["stage4"]["milestones"]["total_cost_estimate"]}M</div><div class="kpi-label">总成本</div></div>
                <div class="kpi-item"><div class="kpi-value">{data["stage4"]["milestones"]["overall_success_rate"]*100:.0f}%</div><div class="kpi-label">综合成功率</div></div>
            </div>
        </div>
    </div>

    <!-- 最终建议 -->
    <div class="card full">
        <h2>综合评估与建议</h2>
        <div class="grid" style="grid-template-columns:1fr 1fr">
            <div>
                <h3>优势</h3>
                <ul style="padding-left:20px;color:#2e7d32">
                    <li>EGFR 是经过充分验证的靶点，成药性极高 (Tchem)</li>
                    <li>已有 156 个已知药物，包括三代 TKI</li>
                    <li>LUAD 中与生存预后显著相关</li>
                </ul>
            </div>
            <div>
                <h3>风险</h3>
                <ul style="padding-left:20px;color:#c62828">
                    <li>竞争极其激烈 (487 个临床试验)</li>
                    <li>耐药突变问题 (C797S, T790M)</li>
                    <li>正常组织高表达 → CNS 脱靶风险</li>
                    <li>免疫抑制微环境可能影响联合疗效</li>
                </ul>
            </div>
        </div>
        <div class="summary-box" style="margin-top:16px">
            <strong>结论:</strong> EGFR 作为肺癌靶点已高度成熟。如果要进入此赛道，建议聚焦于：
            (1) 第四代 TKI 针对 C797S 三重突变；
            (2) EGFR + 免疫检查点联合策略；
            (3) EGFR ADC 或双特异性抗体等新 modality。
        </div>
    </div>

    <div class="footer">
        药物靶点智能研究平台 — 自动生成报告 &nbsp;|&nbsp; 数据来源: GTEx, TCGA/GDC, GEO, OpenTargets, PubMed, ClinicalTrials.gov
    </div>
</div>
</body>
</html>"""

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(html)

    return output_path


def main():
    output_dir = Path(__file__).parent.parent / "output" / "demo"
    output_dir.mkdir(parents=True, exist_ok=True)

    print("构造演示数据...")
    data = make_demo_data()

    print("生成 HTML 报告...")
    html_path = generate_html_report(data, output_dir / "report.html")
    print(f"HTML 报告: {html_path}")

    # 同时输出 JSON 结构
    json_path = output_dir / "pipeline_output.json"
    json_output = {
        "success": True,
        "stage": "full",
        "target": "EGFR",
        "disease": "lung cancer",
        "stages": {
            "stage1": {
                "success": True,
                "gene": "EGFR",
                "ensg_id": "ENSG00000146648",
                "cancer_types": ["LUAD", "BRCA"],
                "summary": {
                    "gene": "EGFR",
                    "data_sources": ["GTEx", "TCGA-LUAD", "TCGA-BRCA", "ImmuneDataManager"],
                    "confidence_level": "high",
                    "key_findings": [
                        "Brain 组织表达最高 (15.2 TPM)",
                        "LUAD 中 EGFR 高表达与较差预后显著相关 (HR=1.72, p=0.008)",
                        "与 CD8+ T 细胞呈负相关 (r=-0.32, p<0.001)"
                    ]
                }
            },
            "stage2": {
                "success": True,
                "disease": "lung cancer",
                "summary": {
                    "data_sources": ["GEO", "OpenTargets"],
                    "top_candidates": data["stage2"]["ranking"][:3]
                }
            },
            "stage3": {
                "success": True,
                "target": "EGFR",
                "summary": {
                    "developability": {"score": 85, "level": "high", "interpretation": "高开发潜力，但竞争激烈"},
                    "recommendations": ["关注耐药突变策略", "探索新 modality"]
                }
            },
            "stage4": {
                "success": True,
                "summary": {
                    "milestones": {
                        "total_duration": f"{data['stage4']['milestones']['total_duration_months']}个月",
                        "total_cost": f"${data['stage4']['milestones']['total_cost_estimate']}M",
                        "success_rate": f"{data['stage4']['milestones']['overall_success_rate']*100:.0f}%"
                    }
                }
            }
        }
    }

    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(json_output, f, ensure_ascii=False, indent=2)
    print(f"JSON 输出: {json_path}")

    print(f"\n用浏览器打开: {html_path}")


if __name__ == "__main__":
    main()
