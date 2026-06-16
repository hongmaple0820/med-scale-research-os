#!/usr/bin/env python3
"""
中文专业报告生成器 - 从已有 JSON 数据生成高质量中文分析报告。
读取各阶段输出的 JSON 数据文件，生成包含专业分析和解读的完整中文报告。
"""

import json
from datetime import datetime
from pathlib import Path


def _load_json(path: Path) -> dict | None:
    """安全加载 JSON 文件。"""
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _p_fmt(p: float) -> str:
    """格式化 p 值。"""
    if p < 0.001:
        return "P < 0.001"
    elif p < 0.01:
        return f"P = {p:.3f}"
    else:
        return f"P = {p:.2f}"


def _significance_emoji(p: float) -> str:
    """根据 p 值返回显著性标记。"""
    if p < 0.001:
        return "***"
    elif p < 0.01:
        return "**"
    elif p < 0.05:
        return "*"
    return "ns"


def _hr_interpretation(hr: float) -> str:
    """解读风险比。"""
    if hr > 1.5:
        return "高风险因子，死亡风险显著增加"
    elif hr > 1.2:
        return "中等风险因子，死亡风险有所增加"
    elif hr > 1.0:
        return "弱风险因子，死亡风险轻微增加"
    elif hr == 1.0:
        return "无预后价值"
    else:
        return "保护因子，与较好预后相关"


def _tau_interpretation(tau: float) -> str:
    """解读 Tau 指数。"""
    if tau > 0.8:
        return "高度组织特异性，靶向安全性窗口较大"
    elif tau > 0.5:
        return "中等组织特异性，靶向治疗需关注安全性窗口"
    else:
        return "广泛组织表达，靶向治疗安全性窗口较窄"


def _tme_interpretation(phenotype: str) -> dict:
    """解读 TME 表型。"""
    interpretations = {
        "hot": {
            "name": "热肿瘤 (Hot)",
            "desc": "免疫细胞高度浸润，肿瘤微环境呈免疫激活状态",
            "therapy": "对免疫检查点抑制剂 (ICI) 应答率高，推荐单药或联合 PD-1/PD-L1 抑制剂",
            "challenge": "需关注免疫相关不良事件 (irAE) 的管理",
        },
        "cold": {
            "name": "冷肿瘤 (Cold)",
            "desc": "免疫细胞浸润极少，肿瘤微环境呈免疫荒漠状态",
            "therapy": "单药 ICI 效果有限，需联合策略促进免疫浸润（如化疗、放疗、STING 激动剂）",
            "challenge": "如何将冷肿瘤转化为热肿瘤是关键挑战",
        },
        "excluded": {
            "name": "免疫排斥型 (Excluded)",
            "desc": "免疫细胞存在于肿瘤间质但被排斥在肿瘤核心之外，存在物理屏障",
            "therapy": "单药 ICI 效果有限，建议联合 T 细胞浸润促进剂（如抗血管生成药物、基质降解策略）",
            "challenge": "需突破肿瘤基质屏障，促进 T 细胞向肿瘤核心迁移",
        },
        "immunosuppressive": {
            "name": "免疫抑制型 (Immunosuppressive)",
            "desc": "存在大量免疫抑制细胞（Treg、MDSC），主动抑制抗肿瘤免疫",
            "therapy": "需联合免疫调节策略（如抗 CTLA-4、Treg 耗竭、IDO 抑制剂）",
            "challenge": "免疫抑制网络复杂，需多靶点联合干预",
        },
    }
    return interpretations.get(phenotype, {
        "name": phenotype,
        "desc": "未分类的肿瘤微环境表型",
        "therapy": "需进一步表征以指导免疫治疗策略",
        "challenge": "表型不明确，需更多数据支持",
    })


def generate_provenance_appendix(report_data: dict) -> str:
    """从报告 JSON 数据中提取溯源信息，生成 Markdown 附录。

    遍历 ``report_data["sections"]`` 中每个 section 的 ``provenance`` 字段，
    汇总为一张溯源表格。如果没有任何 provenance 数据，返回空字符串。

    Expected provenance dict shape per section::

        {
            "source": "GTEx Portal v2",
            "api_endpoint": "https://gtexportal.org/api/v2/...",
            "query_time": "2026-06-05T10:30:00",
            "confidence": "HIGH"
        }

    Args:
        report_data: 完整报告 JSON（含 ``sections`` 列表）。

    Returns:
        Markdown 格式的溯源附录字符串。
    """
    sections = report_data.get("sections", [])
    provenance_items = []
    for section in sections:
        prov = section.get("provenance") if isinstance(section, dict) else None
        if prov and isinstance(prov, dict) and prov.get("source"):
            provenance_items.append(prov)

    if not provenance_items:
        return ""

    lines = [
        "\n---\n\n",
        "## 附录：数据溯源 (Data Provenance)\n\n",
        "以下列出本报告中使用的所有数据来源及其溯源信息，确保结果可追溯、可验证。\n\n",
        "| 数据来源 | API 端点 | 查询时间 | 置信度 |\n",
        "|----------|----------|----------|--------|\n",
    ]
    for item in provenance_items:
        source = item.get("source", "Unknown")
        endpoint = item.get("api_endpoint", "N/A")
        query_time = item.get("query_time", "N/A")
        confidence = item.get("confidence", "MEDIUM")
        lines.append(f"| {source} | {endpoint} | {query_time} | {confidence} |\n")
    lines.append("\n")
    return "".join(lines)


def generate_chinese_report(output_dir: Path, gene: str, cancer_type: str) -> str:
    """
    从已有 JSON 数据生成完整的中文专业报告。

    Args:
        output_dir: 输出目录路径
        gene: 基因符号 (如 KRAS)
        cancer_type: 癌症类型 (如 LUAD)

    Returns:
        Markdown 格式的中文报告字符串
    """
    # 加载所有数据文件
    gtex = _load_json(output_dir / f"gtex_{gene}_expression.json")
    survival = _load_json(output_dir / f"survival_{gene}_{cancer_type}_results.json")
    immune = _load_json(output_dir / f"immune_{gene}_{cancer_type}_correlation.json")
    tme = _load_json(output_dir / f"tme_{gene}_{cancer_type}_profile.json")
    competitive = _load_json(output_dir / f"competitive_{gene}_intelligence.json")
    milestones = _load_json(output_dir / f"milestones_{gene}.json")
    research = _load_json(output_dir / f"tooluniverse_{gene}_research_profile.json")
    protein = _load_json(output_dir / f"protein_{gene}_info.json")

    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    cancer_cn = {"LUAD": "肺腺癌", "LUSC": "肺鳞癌", "BRCA": "乳腺癌", "COAD": "结肠癌"}.get(cancer_type, cancer_type)

    sections = []

    # ═══════════════════════════════════════════════
    # 封面 & 执行摘要
    # ═══════════════════════════════════════════════
    sections.append(f"""# {gene} 靶点智能分析报告

> **靶点基因:** {gene} | **适应症:** {cancer_cn} ({cancer_type})
> **生成时间:** {now} | **数据来源:** GTEx, TCGA, ClinicalTrials.gov, UniProt, STRING
> **免责声明:** 本报告由 AI 系统自动生成，仅供科研参考，不构成临床建议或投资建议。

---

## 一、执行摘要

""")
    # 执行摘要 - 动态生成
    summary_parts = []
    if gtex:
        tau = gtex.get("summary_stats", {}).get("tau_index", 0)
        n_tissues = gtex.get("summary_stats", {}).get("n_tissues", 0) or len(gtex.get("expression_by_tissue", {}))
        summary_parts.append(f"{gene} 在 GTEx 数据库中 {n_tissues} 个组织中检测到表达，Tau 特异性指数为 {tau:.3f}（{_tau_interpretation(tau)}）")
    if survival:
        hr = survival.get("survival_stats", {}).get("cox_regression", {}).get("hazard_ratio", 0)
        p = survival.get("survival_stats", {}).get("cox_regression", {}).get("cox_pvalue", 1)
        n = survival.get("survival_stats", {}).get("n_high", 0) + survival.get("survival_stats", {}).get("n_low", 0)
        summary_parts.append(f"TCGA-{cancer_type} 生存分析（n={n}）显示 {gene} 高表达与不良预后显著相关（HR={hr:.3f}, {_p_fmt(p)}）")
    if tme:
        phen = tme.get("phenotype", "unknown")
        interp = _tme_interpretation(phen)
        therapy_brief = interp['therapy'].split('，')[0] if '，' in interp['therapy'] else interp['therapy'][:30]
        summary_parts.append(f"肿瘤微环境表型为{interp['name']}，{therapy_brief}")
    if competitive:
        trials = competitive.get("competition", {}).get("total_trials", 0)
        drugs = competitive.get("competition", {}).get("total_drugs", 0)
        summary_parts.append(f"目前 {gene} 相关临床试验 {trials} 个，已上市药物 {drugs} 个")

    if research:
        grade = research.get("overall_grade", "")
        conf = research.get("confidence_score", 0)
        grade_map = {"T1": "★★★ 强", "T2": "★★☆ 中等", "T3": "★☆☆ 弱", "T4": "☆☆☆ 不足"}
        summary_parts.append(f"综合证据等级: {grade_map.get(grade, grade)}（置信度 {conf:.0f}%）")

    for i, part in enumerate(summary_parts):
        sections.append(f"{i+1}. {part}\n")

    sections.append("\n---\n\n")

    # ═══════════════════════════════════════════════
    # 靶点生物学背景
    # ═══════════════════════════════════════════════
    sections.append("## 二、靶点生物学背景\n\n")
    if protein:
        prot_data = protein.get("protein_data", {})
        func = prot_data.get("function", "")
        subcell = prot_data.get("subcellular_location", "")
        interactions = protein.get("interactions", [])

        sections.append(f"### 2.1 蛋白基本信息\n\n")
        sections.append(f"| 属性 | 值 |\n|------|----|\n")
        sections.append(f"| 蛋白名称 | {prot_data.get('recommended_name', gene)} |\n")
        sections.append(f"| UniProt ID | {prot_data.get('accession', 'N/A')} |\n")
        sections.append(f"| 亚细胞定位 | {subcell} |\n")
        sections.append(f"| 染色体位置 | {gtex.get('gene_info', {}).get('chromosome', 'N/A') if gtex else 'N/A'} |\n\n")

        if func:
            sections.append(f"### 2.2 分子功能\n\n{func}\n\n")
        if interactions:
            sections.append(f"### 2.3 关键相互作用蛋白\n\n")
            sections.append(f"通过 STRING 数据库分析，{gene} 的 Top 5 相互作用蛋白为：\n\n")
            for inter in interactions[:5]:
                name = inter.get("preferred_name_A", "") or inter.get("preferred_name_B", "")
                score = inter.get("score", 0)
                sections.append(f"- **{name}** (置信度: {score:.3f})\n")
            sections.append("\n")

    sections.append("---\n\n")

    # ═══════════════════════════════════════════════
    # 表达谱分析
    # ═══════════════════════════════════════════════
    sections.append("## 三、组织表达谱分析（GTEx 数据库）\n\n")
    if gtex:
        expr = gtex.get("expression_by_tissue", {})
        stats = gtex.get("summary_stats", {})
        tau = stats.get("tau_index", 0)
        n_tissues = stats.get("n_tissues", len(expr))

        # 排序取 top 10
        sorted_tissues = sorted(expr.items(), key=lambda x: x[1], reverse=True)[:10]

        sections.append(f"### 3.1 表达概况\n\n")
        sections.append(f"- **检测组织数:** {n_tissues} 个\n")
        sections.append(f"- **Tau 特异性指数:** {tau:.3f}\n")
        sections.append(f"- **特异性评价:** {_tau_interpretation(tau)}\n")
        sections.append(f"- **最高表达组织:** {sorted_tissues[0][0]} ({sorted_tissues[0][1]:.1f} TPM)\n")
        sections.append(f"- **最低表达组织:** {sorted_tissues[-1][0]} ({sorted_tissues[-1][1]:.1f} TPM)\n\n")

        sections.append(f"### 3.2 Top 10 高表达组织\n\n")
        sections.append(f"| 排名 | 组织 | 表达量 (TPM) | 占最高表达比例 |\n")
        sections.append(f"|------|------|-------------|---------------|\n")
        max_expr = sorted_tissues[0][1]
        for i, (tissue, tpm) in enumerate(sorted_tissues):
            pct = (tpm / max_expr) * 100
            sections.append(f"| {i+1} | {tissue} | {tpm:.1f} | {pct:.0f}% |\n")
        sections.append("\n")

        sections.append(f"### 3.3 临床意义解读\n\n")
        sections.append(f"Tau 指数 {tau:.3f} 表明 {gene} 具有{_tau_interpretation(tau)[:6]}。")
        sections.append(f"在肺组织中的表达量为 {expr.get('Lung', 0):.1f} TPM")
        lung_rank = sorted([t for t in expr.items()], key=lambda x: x[1], reverse=True)
        lung_pos = next((i+1 for i, (t, _) in enumerate(lung_rank) if t == "Lung"), "N/A")
        sections.append(f"，在所有组织中排名第 {lung_pos} 位。\n\n")
        sections.append(f"**对药物开发的启示:**\n")
        if tau > 0.5:
            sections.append(f"- 较高的组织特异性提示存在一定的安全性窗口\n")
            sections.append(f"- 需特别关注高表达组织（如 {sorted_tissues[0][0]}）的脱靶毒性\n")
        else:
            sections.append(f"- 广泛表达提示需谨慎评估全身毒性\n")
            sections.append(f"- 建议开发高选择性抑制剂或局部给药策略\n")

    # 图片引用（使用正斜杠）
    fig_path = f"skills/target-intelligence/output/{gene}/gtex_{gene}_expression.png"
    sections.append(f"\n![{gene} 组织表达谱]({fig_path})\n\n")
    sections.append("---\n\n")

    # ═══════════════════════════════════════════════
    # 生存分析
    # ═══════════════════════════════════════════════
    sections.append(f"## 四、生存分析（TCGA-{cancer_type}）\n\n")
    if survival:
        ss = survival.get("survival_stats", {})
        cox = ss.get("cox_regression", {})
        hr = cox.get("hazard_ratio", 0)
        hr_ci_lo = cox.get("hr_ci_lower", 0)
        hr_ci_hi = cox.get("hr_ci_upper", 0)
        cox_p = cox.get("cox_pvalue", 1)
        c_index = cox.get("concordance_index", 0)
        n_high = ss.get("n_high", 0)
        n_low = ss.get("n_low", 0)
        events_high = ss.get("events_high", 0)
        events_low = ss.get("events_low", 0)
        median_high = ss.get("median_survival_high_months", 0)
        median_low = ss.get("median_survival_low_months", 0)
        cutoff = ss.get("median_expression_cutoff", 0)

        sections.append(f"### 4.1 研究设计\n\n")
        sections.append(f"- **数据集:** TCGA-{cancer_type} (PanCancer Atlas)\n")
        sections.append(f"- **样本量:** {n_high + n_low} 例\n")
        sections.append(f"- **分组方法:** 按 {gene} 表达中位数 ({cutoff:.1f}) 分为高/低表达组\n")
        sections.append(f"- **高表达组:** {n_high} 例（事件数: {events_high}）\n")
        sections.append(f"- **低表达组:** {n_low} 例（事件数: {events_low}）\n\n")

        sections.append(f"### 4.2 Cox 回归分析结果\n\n")
        sections.append(f"| 指标 | 值 | 解读 |\n")
        sections.append(f"|------|-----|------|\n")
        sections.append(f"| 风险比 (HR) | {hr:.3f} | {_hr_interpretation(hr)} |\n")
        sections.append(f"| 95% 置信区间 | [{hr_ci_lo:.3f}, {hr_ci_hi:.3f}] | {'不包含 1.0，结果可信' if hr_ci_lo > 1 or hr_ci_hi < 1 else '包含 1.0，需谨慎解读'} |\n")
        sections.append(f"| P 值 | {_p_fmt(cox_p)} | {_significance_emoji(cox_p)} {'统计学显著' if cox_p < 0.05 else '未达统计学显著'} |\n")
        sections.append(f"| 一致性指数 (C-index) | {c_index:.3f} | {'预测能力较好' if c_index > 0.6 else '预测能力中等' if c_index > 0.55 else '预测能力有限'} |\n\n")

        sections.append(f"### 4.3 中位生存期比较\n\n")
        sections.append(f"| 分组 | 中位生存期 | 差异 |\n")
        sections.append(f"|------|-----------|------|\n")
        sections.append(f"| {gene} 高表达组 | {median_high:.1f} 个月 | — |\n")
        sections.append(f"| {gene} 低表达组 | {median_low:.1f} 个月 | +{median_low - median_high:.1f} 个月 |\n\n")

        sections.append(f"### 4.4 临床意义\n\n")
        if cox_p < 0.05 and hr > 1:
            sections.append(f"**结论:** {gene} 高表达是 {cancer_cn} 患者的独立不良预后因子。\n\n")
            sections.append(f"- 高表达组死亡风险增加 {(hr-1)*100:.1f}%（HR={hr:.3f}）\n")
            sections.append(f"- 中位生存期缩短 {median_low - median_high:.1f} 个月\n")
            sections.append(f"- 支持 {gene} 作为预后生物标志物和治疗靶点的合理性\n")
        elif cox_p < 0.05 and hr < 1:
            sections.append(f"**结论:** {gene} 高表达与较好的预后相关，提示其可能具有抑癌功能。\n\n")
        else:
            sections.append(f"**结论:** 在当前样本量下，{gene} 表达与预后的关联未达统计学显著阈值。\n\n")

    fig_path = f"skills/target-intelligence/output/{gene}/survival_{gene}_{cancer_type}_km.png"
    sections.append(f"![{gene} 生存曲线]({fig_path})\n\n")
    sections.append("---\n\n")

    # ═══════════════════════════════════════════════
    # 免疫微环境分析
    # ═══════════════════════════════════════════════
    sections.append(f"## 五、肿瘤免疫微环境分析\n\n")
    if tme:
        phen = tme.get("phenotype", "unknown")
        interp = _tme_interpretation(phen)
        immune_score = tme.get("immune_score", 0)
        stromal_score = tme.get("stromal_score", 0)
        confidence = tme.get("phenotype_confidence", 0)

        sections.append(f"### 5.1 TME 表型分类\n\n")
        sections.append(f"| 属性 | 值 |\n")
        sections.append(f"|------|-----|\n")
        sections.append(f"| TME 表型 | {interp['name']} |\n")
        sections.append(f"| 免疫评分 | {immune_score}/100 |\n")
        sections.append(f"| 基质评分 | {stromal_score}/100 |\n")
        sections.append(f"| 分类置信度 | {confidence*100:.0f}% |\n\n")

        sections.append(f"### 5.2 表型解读\n\n")
        sections.append(f"**{interp['name']}**: {interp['desc']}。\n\n")
        sections.append(f"**免疫治疗策略建议:** {interp['therapy']}。\n\n")
        sections.append(f"**关键挑战:** {interp['challenge']}。\n\n")

        # 免疫细胞浸润
        cells = tme.get("immune_cells", [])
        sig_cells = [c for c in cells if c.get("significant")]
        sections.append(f"### 5.3 免疫细胞浸润分析\n\n")
        if sig_cells:
            sections.append(f"与 {gene} 表达显著相关的免疫细胞（校正后 P < 0.05）：\n\n")
            sections.append(f"| 免疫细胞 | 相关系数 | P 值 | 方向 | 功能角色 |\n")
            sections.append(f"|----------|---------|------|------|----------|\n")
            for c in sig_cells:
                r = c.get("correlation_with_target", 0)
                direction = "负相关 ↓" if r < 0 else "正相关 ↑"
                role = {"effector": "效应细胞", "regulatory": "调节性细胞", "other": "其他"}.get(c.get("role", ""), c.get("role", ""))
                p_val = c.get("pvalue", 1)
                sections.append(f"| {c.get('cell_type', '')} | {r:.3f} | {_p_fmt(p_val)} | {direction} | {role} |\n")
            sections.append("\n")

            sections.append(f"**解读:** {gene} 表达与以下免疫细胞呈显著负相关：\n")
            neg_cells = [c for c in sig_cells if c.get("correlation_with_target", 0) < 0]
            for c in neg_cells:
                sections.append(f"- {c['cell_type']}: r={c['correlation_with_target']:.3f}，提示 {gene} 高表达可能抑制该细胞的肿瘤浸润\n")
            sections.append("\n")
        else:
            sections.append(f"在当前分析中，未发现与 {gene} 表达显著相关的免疫细胞（校正后 P < 0.05）。\n\n")

        # 免疫逃逸机制
        evasion = tme.get("evasion_mechanisms", [])
        if evasion:
            evasion_cn_map = {
                "Immune exclusion: negative correlation with infiltrating cells":
                    "免疫排斥: 与浸润性免疫细胞呈负相关，肿瘤通过物理屏障将免疫细胞排斥在核心之外",
                "Immune suppression: positive correlation with suppressive cells":
                    "免疫抑制: 与抑制性免疫细胞呈正相关，肿瘤主动招募免疫抑制细胞",
            }
            sections.append(f"### 5.4 免疫逃逸机制\n\n")
            for mech in evasion:
                mech_cn = evasion_cn_map.get(mech, mech)
                sections.append(f"- {mech_cn}\n")
            sections.append("\n")

    fig_path = f"skills/target-intelligence/output/{gene}/immune_{gene}_{cancer_type}_heatmap.png"
    sections.append(f"![免疫细胞浸润热图]({fig_path})\n\n")
    sections.append("---\n\n")

    # ═══════════════════════════════════════════════
    # 竞争格局分析
    # ═══════════════════════════════════════════════
    sections.append("## 六、竞争格局分析\n\n")
    if competitive:
        comp = competitive.get("competition", {})
        total_trials = comp.get("total_trials", 0)
        total_drugs = comp.get("total_drugs", 0)
        phase_dist = comp.get("phase_distribution", {})
        status_dist = comp.get("status_distribution", {})
        key_players = comp.get("key_players", [])
        action_types = comp.get("action_types", {})

        sections.append(f"### 6.1 临床试验概况\n\n")
        sections.append(f"- **临床试验总数:** {total_trials} 个\n")
        sections.append(f"- **已上市药物:** {total_drugs} 个\n\n")

        sections.append(f"### 6.2 临床阶段分布\n\n")
        sections.append(f"| 阶段 | 试验数量 | 占比 |\n")
        sections.append(f"|------|---------|------|\n")
        phase_cn = {"PHASE1": "I 期", "PHASE2": "II 期", "PHASE3": "III 期", "EARLY_PHASE1": "早期 I 期", "NA": "未分类"}
        for phase, count in sorted(phase_dist.items()):
            pct = (count / total_trials) * 100
            sections.append(f"| {phase_cn.get(phase, phase)} | {count} | {pct:.0f}% |\n")
        sections.append("\n")

        sections.append(f"### 6.3 试验状态分布\n\n")
        sections.append(f"| 状态 | 数量 |\n")
        sections.append(f"|------|------|\n")
        status_cn = {
            "RECRUITING": "招募中", "ACTIVE_NOT_RECRUITING": "进行中（停止招募）",
            "TERMINATED": "已终止", "NOT_YET_RECRUITING": "尚未招募",
            "COMPLETED": "已完成", "UNKNOWN": "未知", "WITHDRAWN": "已撤回",
        }
        for status, count in sorted(status_dist.items(), key=lambda x: x[1], reverse=True):
            sections.append(f"| {status_cn.get(status, status)} | {count} |\n")
        sections.append("\n")

        if key_players:
            sections.append(f"### 6.4 主要竞争者\n\n")
            sections.append(f"| 企业 | 试验数 | 活跃试验 | 阶段 |\n")
            sections.append(f"|------|--------|---------|------|\n")
            for player in key_players[:8]:
                company = player.get("company", "")
                t_count = player.get("trial_count", 0)
                a_count = player.get("active_trials", 0)
                phases = ", ".join(player.get("phases", []))
                sections.append(f"| {company} | {t_count} | {a_count} | {phases} |\n")
            sections.append("\n")

        if action_types:
            sections.append(f"### 6.5 药物作用机制\n\n")
            for action, count in action_types.items():
                sections.append(f"- **{action}**: {count} 个药物\n")
            sections.append("\n")

        # 竞争态势分析
        sections.append(f"### 6.6 竞争态势分析\n\n")
        p1_count = phase_dist.get("PHASE1", 0)
        p2_count = phase_dist.get("PHASE2", 0)
        p3_count = phase_dist.get("PHASE3", 0)

        if p3_count > 0:
            sections.append(f"- 赛道已进入成熟期，{p3_count} 个试验处于 III 期\n")
        elif p2_count > 0:
            sections.append(f"- 赛道处于成长期，{p2_count} 个试验处于 II 期\n")
        else:
            sections.append(f"- 赛道尚处早期，以 I 期试验为主\n")

        recruiting = status_dist.get("RECRUITING", 0)
        terminated = status_dist.get("TERMINATED", 0)
        if terminated > 0:
            sections.append(f"- {terminated} 个试验已终止，需关注终止原因（安全性/有效性/商业策略）\n")
        if recruiting > 0:
            sections.append(f"- {recruiting} 个试验正在招募，赛道活跃度较高\n")

    fig_path = f"skills/target-intelligence/output/{gene}/phase3_{gene}_key_players.png"
    sections.append(f"\n![竞争格局]({fig_path})\n\n")
    sections.append("---\n\n")

    # ═══════════════════════════════════════════════
    # 开发时间线
    # ═══════════════════════════════════════════════
    sections.append("## 七、药物开发时间线\n\n")
    if milestones:
        ms_list = milestones.get("milestones", [])
        total_months = sum(m.get("duration_months", 0) for m in ms_list)
        adjustments = milestones.get("adjustments", [])

        sections.append(f"### 7.1 预计开发周期\n\n")
        sections.append(f"- **总开发周期:** 约 {total_months} 个月（{total_months/12:.1f} 年）\n")
        sections.append(f"- **药物模态:** {milestones.get('modality', 'N/A')}\n\n")

        sections.append(f"### 7.2 关键里程碑\n\n")
        sections.append(f"| 阶段 | 起始 | 结束 | 周期 | 主要工作 |\n")
        sections.append(f"|------|------|------|------|----------|\n")
        milestone_desc_cn = {
            "Target validation, assay development, hit identification": "靶点验证、检测方法开发、苗头化合物筛选",
            "Hit confirmation, selectivity profiling, initial SAR": "苗头确认、选择性分析、初步构效关系研究",
            "Potency, selectivity, ADMET optimization": "活性优化、选择性优化、ADMET 性质优化",
            "GLP toxicology, PK/PD, CMC, IND-enabling studies": "GLP 毒理学、药代动力学/药效学、CMC、IND 申报准备",
            "First-in-human, dose escalation, safety/PK": "首次人体试验、剂量爬坡、安全性/药代动力学评估",
            "Dose expansion, efficacy signals, biomarker validation": "剂量扩展、有效性信号探索、生物标志物验证",
            "Pivotal efficacy trials, registration": "关键性有效性试验、注册申报",
            "NDA/BLA submission and review": "NDA/BLA 申报与审评",
        }
        for ms in ms_list:
            phase_cn = {
                "Discovery": "靶点发现", "Hit To Lead": "苗头到先导", "Lead Optimization": "先导化合物优化",
                "Preclinical": "临床前研究", "Phase1": "I 期临床", "Phase2": "II 期临床",
                "Phase3": "III 期临床", "Approval": "上市审批",
            }.get(ms.get("phase", ""), ms.get("phase", ""))
            desc_en = ms.get("description", "")
            desc_cn = milestone_desc_cn.get(desc_en, desc_en)
            sections.append(f"| {phase_cn} | {ms.get('start_date', '')} | {ms.get('end_date', '')} | {ms.get('duration_months', 0)} 个月 | {desc_cn} |\n")
        sections.append("\n")

        if adjustments:
            sections.append(f"### 7.3 时间线调整因素\n\n")
            for adj in adjustments:
                delta = adj.get("months_delta", 0)
                direction = "缩短" if delta < 0 else "延长"
                desc = adj.get("description", "")
                # 简单翻译常见描述
                if "Low competition" in desc:
                    desc = "竞争较少，可能缩短发现阶段"
                sections.append(f"- {desc}：预计{direction} {abs(delta)} 个月\n")
            sections.append("\n")

        sections.append(f"### 7.4 风险评估\n\n")
        risks = milestones.get("risks", [])
        if risks:
            risk_desc_cn = {
                "No major risks identified from available data.": "现有数据未识别到重大风险",
                "Standard risk management approach": "标准风险管理流程",
            }
            for risk in risks:
                severity_cn = {"low": "低", "medium": "中", "high": "高"}.get(risk.get("severity", ""), risk.get("severity", ""))
                desc = risk_desc_cn.get(risk.get("description", ""), risk.get("description", ""))
                mitigation = risk_desc_cn.get(risk.get("mitigation", ""), risk.get("mitigation", ""))
                sections.append(f"- **风险等级: {severity_cn}** — {desc}\n")
                sections.append(f"  - 缓解措施: {mitigation}\n")
        else:
            sections.append(f"当前数据未识别到重大开发风险。\n")
        sections.append("\n")

    fig_path = f"skills/target-intelligence/output/{gene}/milestones_{gene}_timeline.png"
    sections.append(f"![开发时间线]({fig_path})\n\n")
    sections.append("---\n\n")

    # ═══════════════════════════════════════════════
    # 证据等级评估
    # ═══════════════════════════════════════════════
    sections.append("## 八、证据等级评估\n\n")
    if research:
        grade = research.get("overall_grade", "")
        conf = research.get("confidence_score", 0)
        grade_map = {"T1": "★★★ 强证据", "T2": "★★☆ 中等证据", "T3": "★☆☆ 弱证据", "T4": "☆☆☆ 证据不足"}
        paths = research.get("paths", {})

        sections.append(f"### 8.1 综合评估\n\n")
        sections.append(f"| 维度 | 结果 |\n")
        sections.append(f"|------|------|\n")
        sections.append(f"| 综合证据等级 | {grade_map.get(grade, grade)} |\n")
        sections.append(f"| 置信度 | {conf:.0f}% |\n\n")

        sections.append(f"### 8.2 各维度证据等级\n\n")
        sections.append(f"| 维度 | 证据等级 | 证据数 | 摘要 |\n")
        sections.append(f"|------|---------|--------|------|\n")
        for key, path_data in paths.items():
            path_name = path_data.get("name", key)
            best = path_data.get("best_grade", "")
            count = path_data.get("evidence_count", 0)
            summary = path_data.get("summary", "—")
            sections.append(f"| {path_name} | {grade_map.get(best, best)} | {count} | {summary} |\n")
        sections.append("\n")

    sections.append("---\n\n")

    # ═══════════════════════════════════════════════
    # 结论与建议
    # ═══════════════════════════════════════════════
    sections.append("## 九、结论与建议\n\n")

    sections.append(f"### 9.1 核心发现\n\n")
    finding_idx = 1
    if gtex:
        tau = gtex.get("summary_stats", {}).get("tau_index", 0)
        sections.append(f"{finding_idx}. **表达特征:** {gene} 在多个组织中表达（Tau={tau:.3f}），{_tau_interpretation(tau)[:20]}\n")
        finding_idx += 1
    if survival and survival.get("survival_stats", {}).get("cox_regression", {}).get("cox_pvalue", 1) < 0.05:
        hr = survival["survival_stats"]["cox_regression"]["hazard_ratio"]
        sections.append(f"{finding_idx}. **预后价值:** {gene} 高表达与不良预后显著相关（HR={hr:.3f}），可作为预后生物标志物\n")
        finding_idx += 1
    if tme:
        phen = tme.get("phenotype", "unknown")
        interp = _tme_interpretation(phen)
        therapy_summary = interp['therapy'].split('，')[0] if '，' in interp['therapy'] else interp['therapy']
        sections.append(f"{finding_idx}. **免疫微环境:** TME 表型为{interp['name']}，{therapy_summary}\n")
        finding_idx += 1
    if competitive:
        trials = competitive.get("competition", {}).get("total_trials", 0)
        sections.append(f"{finding_idx}. **竞争格局:** 目前 {trials} 个临床试验，赛道{'竞争激烈' if trials > 20 else '竞争适中' if trials > 10 else '竞争较少'}\n")
        finding_idx += 1
    sections.append("\n")

    sections.append(f"### 9.2 开发策略建议\n\n")
    sections.append(f"1. **靶点验证:** 建议通过功能实验（CRISPR 敲除/敲低）进一步验证 {gene} 在 {cancer_cn} 中的驱动功能\n")
    sections.append(f"2. **患者分层:** 基于表达水平和 TME 表型进行患者分层，筛选最可能获益的人群\n")
    if tme and tme.get("phenotype") == "excluded":
        sections.append(f"3. **联合策略:** TME 为免疫排斥型，建议联合抗血管生成药物或基质调节剂促进免疫浸润\n")
    sections.append(f"4. **安全性评估:** 需特别关注高表达组织的脱靶毒性，建议开展全面的安全药理学研究\n")

    sections.append("\n### 9.3 数据局限性\n\n")
    sections.append(f"- 表达数据来自公开数据库（GTEx/TCGA），可能存在选择偏倚\n")
    sections.append(f"- 免疫浸润为计算预测（CIBERSORTx），需流式细胞术或免疫组化验证\n")
    sections.append(f"- 生存分析为回顾性研究，需前瞻性临床试验确认\n")
    sections.append(f"- 竞争数据来自 ClinicalTrials.gov，可能不包含未注册试验\n")
    sections.append(f"- 时间线为估算值，实际开发周期可能因临床结果而调整\n")

    # ═══════════════════════════════════════════════
    # 附录：数据溯源
    # ═══════════════════════════════════════════════
    provenance_report_data = {"sections": []}
    if gtex:
        provenance_report_data["sections"].append({
            "provenance": {
                "source": "GTEx Portal v8",
                "api_endpoint": "https://gtexportal.org/api/v2/expression/geneExpression",
                "query_time": now,
                "confidence": "HIGH",
            }
        })
    if survival:
        provenance_report_data["sections"].append({
            "provenance": {
                "source": "TCGA PanCancer Atlas via cBioPortal",
                "api_endpoint": "https://www.cbioportal.org/api/molecular-profiles",
                "query_time": now,
                "confidence": "HIGH",
            }
        })
    if immune or tme:
        provenance_report_data["sections"].append({
            "provenance": {
                "source": "CIBERSORTx / TIMER2.0",
                "api_endpoint": "https://cibersortx.stanford.edu/",
                "query_time": now,
                "confidence": "MEDIUM",
            }
        })
    if competitive:
        provenance_report_data["sections"].append({
            "provenance": {
                "source": "ClinicalTrials.gov",
                "api_endpoint": "https://clinicaltrials.gov/api/v2/studies",
                "query_time": now,
                "confidence": "HIGH",
            }
        })
    if protein:
        provenance_report_data["sections"].append({
            "provenance": {
                "source": "UniProt / STRING",
                "api_endpoint": "https://rest.uniprot.org/uniprotkb | https://string-db.org/api",
                "query_time": now,
                "confidence": "HIGH",
            }
        })
    if research:
        provenance_report_data["sections"].append({
            "provenance": {
                "source": "ToolUniverse Research Profile",
                "api_endpoint": "internal",
                "query_time": now,
                "confidence": "MEDIUM",
            }
        })

    provenance_appendix = generate_provenance_appendix(provenance_report_data)
    if provenance_appendix:
        sections.append(provenance_appendix)

    sections.append(f"\n---\n\n*报告版本: v3.0 | 生成引擎: Target Intelligence | 生成时间: {now}*\n")

    return "".join(sections)


def save_chinese_report(output_dir: Path, gene: str, cancer_type: str) -> Path:
    """
    生成并保存中文报告到指定目录。

    Args:
        output_dir: 输出目录
        gene: 基因符号
        cancer_type: 癌症类型

    Returns:
        报告文件路径
    """
    output_dir = Path(output_dir)
    report = generate_chinese_report(output_dir, gene, cancer_type)

    report_path = output_dir / f"chinese_report_{gene}_{cancer_type}.md"
    report_path.write_text(report, encoding="utf-8")
    print(f"中文报告已生成: {report_path}")
    return report_path


if __name__ == "__main__":
    import sys
    gene = sys.argv[1] if len(sys.argv) > 1 else "KRAS"
    cancer = sys.argv[2] if len(sys.argv) > 2 else "LUAD"
    out_dir = Path(rf"E:\yixue-scale-engine\skills\target-intelligence\output\{gene}")
    save_chinese_report(out_dir, gene, cancer)
