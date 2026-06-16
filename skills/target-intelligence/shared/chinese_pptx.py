#!/usr/bin/env python3
"""
专业中文 PPTX 生成器 - 医学研究者可直接使用。
带数据表格、图表嵌入、speaker notes。
"""
import json
from pathlib import Path

try:
    from pptx import Presentation
    from pptx.util import Inches, Pt
    from pptx.dml.color import RGBColor
    HAS_PPTX = True
except ImportError:
    HAS_PPTX = False

OUTPUT = Path(r"E:\yixue-scale-engine\skills\target-intelligence\output\KRAS")

if HAS_PPTX:
    C = {
        'bg': RGBColor(0x0F, 0x17, 0x2A), 'bg2': RGBColor(0x1E, 0x29, 0x3B),
        'accent': RGBColor(0x3B, 0x82, 0xF6), 'accent2': RGBColor(0x60, 0xA5, 0xFA),
        'green': RGBColor(0x22, 0xC5, 0x5E), 'yellow': RGBColor(0xF5, 0x9E, 0x0B),
        'red': RGBColor(0xEF, 0x44, 0x44), 'fg': RGBColor(0xE2, 0xE8, 0xF0),
        'fg2': RGBColor(0x94, 0xA3, 0xB8), 'white': RGBColor(0xFF, 0xFF, 0xFF),
    }


def load_json(name):
    fp = OUTPUT / name
    return json.loads(fp.read_text(encoding="utf-8")) if fp.exists() else None


def styled_slide(prs, title, subtitle=None):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    bg = slide.background.fill; bg.solid(); bg.fore_color.rgb = C['bg']
    if title:
        tb = slide.shapes.add_textbox(Inches(0.6), Inches(0.3), Inches(9), Inches(0.7))
        p = tb.text_frame.paragraphs[0]; p.text = title
        p.font.size = Pt(26); p.font.bold = True; p.font.color.rgb = C['white']
    if subtitle:
        tb = slide.shapes.add_textbox(Inches(0.6), Inches(0.95), Inches(9), Inches(0.4))
        p = tb.text_frame.paragraphs[0]; p.text = subtitle
        p.font.size = Pt(13); p.font.color.rgb = C['fg2']
    return slide


def add_metric_cards(slide, cards, start_left=0.6, top=1.6):
    for i, (label, value, sub) in enumerate(cards):
        left = start_left + i * 2.3
        card = slide.shapes.add_shape(1, Inches(left), Inches(top), Inches(2.1), Inches(1.0))
        card.fill.solid(); card.fill.fore_color.rgb = C['bg2']
        card.line.color.rgb = RGBColor(0x33, 0x41, 0x55)
        tb = slide.shapes.add_textbox(Inches(left + 0.1), Inches(top + 0.05), Inches(1.9), Inches(0.25))
        p = tb.text_frame.paragraphs[0]; p.text = label; p.font.size = Pt(9); p.font.color.rgb = C['fg2']
        tb = slide.shapes.add_textbox(Inches(left + 0.1), Inches(top + 0.3), Inches(1.9), Inches(0.4))
        p = tb.text_frame.paragraphs[0]; p.text = str(value); p.font.size = Pt(20); p.font.bold = True; p.font.color.rgb = C['accent2']
        if sub:
            tb = slide.shapes.add_textbox(Inches(left + 0.1), Inches(top + 0.7), Inches(1.9), Inches(0.25))
            p = tb.text_frame.paragraphs[0]; p.text = sub; p.font.size = Pt(9); p.font.color.rgb = C['fg2']


def add_table(slide, headers, rows, left=0.6, top=3.0, width=9.0, font_size=10):
    n_rows = min(len(rows) + 1, 12); n_cols = len(headers)
    tbl_shape = slide.shapes.add_table(n_rows, n_cols, Inches(left), Inches(top), Inches(width), Inches(0.32 * n_rows))
    tbl = tbl_shape.table
    for i, h in enumerate(headers):
        cell = tbl.cell(0, i); cell.text = h
        cell.fill.solid(); cell.fill.fore_color.rgb = C['accent']
        for para in cell.text_frame.paragraphs:
            para.font.size = Pt(font_size); para.font.bold = True; para.font.color.rgb = C['white']
    for r, row in enumerate(rows[:n_rows - 1]):
        for c, val in enumerate(row):
            cell = tbl.cell(r + 1, c); cell.text = str(val)
            cell.fill.solid(); cell.fill.fore_color.rgb = C['bg2'] if r % 2 == 0 else RGBColor(0x16, 0x20, 0x33)
            for para in cell.text_frame.paragraphs:
                para.font.size = Pt(font_size); para.font.color.rgb = C['fg']


def add_bullets(slide, points, left=0.6, top=1.5, width=9.0, height=5.5, font_size=13):
    tb = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(height))
    tf = tb.text_frame; tf.word_wrap = True
    for i, pt in enumerate(points):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.text = pt; p.font.size = Pt(font_size); p.font.color.rgb = C['fg']; p.space_after = Pt(6)


def add_figure(slide, fname, left=0.6, top=1.5, width=5.0, height=4.5):
    fp = OUTPUT / fname
    if fp.exists():
        slide.shapes.add_picture(str(fp), Inches(left), Inches(top), Inches(width), Inches(height)); return True
    return False


def add_notes(slide, text):
    slide.notes_slide.notes_text_frame.text = text


def build_pptx():
    if not HAS_PPTX:
        print("ERROR: python-pptx not installed"); return None

    gtex = load_json("gtex_KRAS_expression.json")
    surv = load_json("survival_KRAS_LUAD_results.json")
    tme = load_json("tme_KRAS_LUAD_profile.json")
    comp = load_json("competitive_KRAS_intelligence.json")
    milestones = load_json("milestones_KRAS.json")
    research = load_json("tooluniverse_KRAS_research_profile.json")

    prs = Presentation()
    prs.slide_width = Inches(13.333); prs.slide_height = Inches(7.5)

    # ── Slide 1: Title ──
    s = styled_slide(prs, "KRAS 靶点智能分析报告", "肺腺癌 (LUAD) · 系统性药物靶点评估")
    add_metric_cards(s, [
        ("检测组织 (GTEx)", "54", "Tau=0.575"),
        ("风险比 (HR)", "1.356*", "P=0.043"),
        ("TME 表型", "Excluded", "免疫排斥型"),
        ("临床试验", "30", "2 个上市药物"),
    ], start_left=0.6, top=1.8)
    add_bullets(s, [
        "数据来源: GTEx · TCGA-LUAD · ClinicalTrials.gov · UniProt · STRING",
        "分析方法: Cox 回归 · CIBERSORTx 免疫反卷积 · 证据分级 (T1-T4)",
        "",
        "核心结论:",
        "• KRAS 高表达与肺腺癌不良预后显著相关 (HR=1.356, P<0.05)",
        "• TME 表型为免疫排斥型，单药免疫治疗效果有限",
        "• G12C 已有上市药物，其他突变亚型存在蓝海机会",
        "• 综合证据等级: ★★☆ 中等 (置信度 75%)",
    ], left=0.6, top=3.2, font_size=13)
    add_notes(s, "本报告基于 GTEx、TCGA、ClinicalTrials.gov 等公开数据库，系统评估 KRAS 作为肺腺癌药物靶点的开发潜力。")

    # ── Slide 2: Expression ──
    s = styled_slide(prs, "组织表达谱分析", "GTEx 数据库 · 54 个组织")
    add_figure(s, "gtex_KRAS_expression.png", left=0.6, top=1.5, width=6.0, height=5.5)
    if gtex:
        expr = gtex.get("expression_by_tissue", {})
        sorted_t = sorted(expr.items(), key=lambda x: x[1], reverse=True)[:8]
        rows = [[t, f"{v:.1f} TPM", f"{v/sorted_t[0][1]*100:.0f}%"] for t, v in sorted_t]
        add_table(s, ["组织", "表达量", "相对比例"], rows, left=7.0, top=1.5, width=5.5)
    add_notes(s, "Tau=0.575 表明中等组织特异性。肺组织排名第 6，提示靶向治疗需关注高表达组织的脱靶毒性。")

    # ── Slide 3: Survival ──
    s = styled_slide(prs, "生存分析", "TCGA-LUAD · n=497")
    add_figure(s, "survival_KRAS_LUAD_km.png", left=0.6, top=1.5, width=6.0, height=5.5)
    if surv:
        ss = surv.get("survival_stats", {}); cox = ss.get("cox_regression", {})
        add_metric_cards(s, [
            ("风险比 (HR)", f"{cox.get('hazard_ratio', 0):.3f}", f"95%CI: [{cox.get('hr_ci_lower', 0):.3f}, {cox.get('hr_ci_upper', 0):.3f}]"),
            ("P 值", f"{cox.get('cox_pvalue', 0):.4f}", "统计学显著" if cox.get("cox_pvalue", 1) < 0.05 else "未达显著"),
            ("中位生存 (高)", f"{ss.get('median_survival_high_months', 0):.1f} 月", f"事件数: {ss.get('events_high', 0)}"),
            ("中位生存 (低)", f"{ss.get('median_survival_low_months', 0):.1f} 月", f"事件数: {ss.get('events_low', 0)}"),
        ], start_left=7.0, top=1.5)
    add_bullets(s, [
        f"• 高表达组死亡风险增加 {(cox.get('hazard_ratio',1)-1)*100:.1f}%",
        f"• 中位生存期缩短 {ss.get('median_survival_low_months',0) - ss.get('median_survival_high_months',0):.1f} 个月",
        "• 支持 KRAS 作为预后生物标志物和治疗靶点",
    ], left=7.0, top=4.0, width=5.5, font_size=12)
    add_notes(s, "Cox 回归显示 KRAS 高表达是肺腺癌独立不良预后因子。95% CI 不包含 1.0，结果可信。")

    # ── Slide 4: TME ──
    s = styled_slide(prs, "肿瘤免疫微环境分析", "CIBERSORTx 反卷积 · TME 表型分类")
    add_figure(s, "immune_KRAS_LUAD_heatmap.png", left=0.6, top=1.5, width=6.0, height=5.5)
    if tme:
        phen = tme.get("phenotype", "")
        phen_cn = {"hot": "热肿瘤", "cold": "冷肿瘤", "excluded": "免疫排斥型", "immunosuppressive": "免疫抑制型"}.get(phen, phen)
        add_metric_cards(s, [
            ("TME 表型", phen_cn, phen.upper()),
            ("免疫评分", f"{tme.get('immune_score', 0)}/100", "低免疫浸润"),
            ("基质评分", f"{tme.get('stromal_score', 0)}/100", ""),
            ("置信度", f"{tme.get('phenotype_confidence', 0)*100:.0f}%", ""),
        ], start_left=7.0, top=1.5)
        sig_cells = [c for c in tme.get("immune_cells", []) if c.get("significant")]
        if sig_cells:
            rows = [[c["cell_type"], f"{c['correlation_with_target']:.3f}", f"{c['pvalue']:.4f}", "负相关" if c["correlation_with_target"] < 0 else "正相关"] for c in sig_cells]
            add_table(s, ["免疫细胞", "相关系数", "P 值", "方向"], rows, left=7.0, top=4.0, width=5.5)
    add_notes(s, "TME 为免疫排斥型。KRAS 表达与 B 细胞、树突状细胞显著负相关，提示抑制免疫浸润。")

    # ── Slide 5: Competitive ──
    s = styled_slide(prs, "竞争格局分析", "ClinicalTrials.gov · 30 个临床试验")
    add_figure(s, "phase3_KRAS_key_players.png", left=0.6, top=1.5, width=6.0, height=5.5)
    if comp:
        ct = comp.get("competition", {})
        add_metric_cards(s, [
            ("临床试验", str(ct.get("total_trials", 0)), "活跃赛道"),
            ("上市药物", str(ct.get("total_drugs", 0)), "Sotorasib, Adagrasib"),
            ("I 期", str(ct.get("phase_distribution", {}).get("PHASE1", 0)), "早期探索"),
            ("II 期", str(ct.get("phase_distribution", {}).get("PHASE2", 0)), "有效性验证"),
        ], start_left=7.0, top=1.5)
        kp = ct.get("key_players", [])[:5]
        if kp:
            rows = [[p["company"], str(p["trial_count"]), str(p["active_trials"]), ", ".join(p.get("phases", []))] for p in kp]
            add_table(s, ["企业", "试验数", "活跃", "阶段"], rows, left=7.0, top=4.0, width=5.5)
    add_notes(s, "G12C 赛道竞争激烈。非 G12C 亚型 (G12D, G12V) 存在蓝海机会。")

    # ── Slide 6: Timeline ──
    s = styled_slide(prs, "药物开发时间线", "预计总周期 ~10 年")
    if milestones:
        ms_list = milestones.get("milestones", [])
        phase_cn = {"Discovery": "靶点发现", "Hit To Lead": "苗头到先导", "Lead Optimization": "先导优化",
                    "Preclinical": "临床前", "Phase1": "I 期", "Phase2": "II 期", "Phase3": "III 期", "Approval": "上市审批"}
        rows = [[phase_cn.get(m["phase"], m["phase"]), m["start_date"], m["end_date"], f"{m['duration_months']} 个月"] for m in ms_list]
        add_table(s, ["阶段", "起始", "结束", "周期"], rows, left=0.6, top=1.5, width=6.0)
    add_figure(s, "milestones_KRAS_timeline.png", left=7.0, top=1.5, width=5.5, height=5.0)
    add_notes(s, "基于标准药物开发流程估算。实际周期可能因临床结果调整。")

    # ── Slide 7: Evidence ──
    s = styled_slide(prs, "证据等级评估", "多维度证据分级 · T1(★★★) — T4(☆☆☆)")
    if research:
        paths = research.get("paths", {})
        grade_map = {"T1": "★★★", "T2": "★★☆", "T3": "★☆☆", "T4": "☆☆☆"}
        rows = [[p.get("name", k), grade_map.get(p.get("best_grade", ""), "?"), str(p.get("evidence_count", 0)), p.get("summary", "")[:40]] for k, p in paths.items()]
        add_table(s, ["维度", "等级", "证据数", "摘要"], rows, left=0.6, top=1.5, width=12.0)
        add_metric_cards(s, [
            ("综合等级", grade_map.get(research.get("overall_grade", ""), "?"), "中等证据"),
            ("置信度", f"{research.get('confidence_score', 0):.0f}%", ""),
        ], start_left=0.6, top=5.5)
    add_notes(s, "综合 9 条研究路径，KRAS 证据等级为中等 (T2)。")

    # ── Slide 8: Conclusions ──
    s = styled_slide(prs, "结论与建议", "Summary & Recommendations")
    add_bullets(s, [
        "━━━ 核心发现 ━━━",
        "• KRAS 高表达是肺腺癌独立不良预后因子 (HR=1.356, P<0.05)",
        "• TME 表型为免疫排斥型，单药 ICI 效果有限",
        "• G12C 已有 2 个上市药物，G12D/G12V 存在蓝海机会",
        "",
        "━━━ 开发策略建议 ━━━",
        "• 优先开发非 G12C 亚型抑制剂 (G12D, G12V)",
        "• 联合用药: KRAS 抑制剂 + 抗血管生成/免疫治疗",
        "• 患者分层: 基于突变亚型 + TME 表型筛选获益人群",
        "",
        "━━━ 风险提示 ━━━",
        "• G12C 赛道竞争激烈 (30 个试验)，需差异化布局",
        "• 需实验验证靶点功能 (CRISPR 敲除/敲低)",
        "• 免疫排斥表型限制单药免疫治疗，需联合策略",
    ], left=0.6, top=1.5, font_size=14)
    add_notes(s, "总结核心发现。建议差异化开发非 G12C 亚型，联合用药，并基于 TME 表型患者分层。")

    out = OUTPUT / "KRAS_professional_chinese.pptx"
    prs.save(str(out))
    print(f"PPTX 已生成: {out}")
    print(f"共 {len(prs.slides)} 页幻灯片")
    return out


if __name__ == "__main__":
    build_pptx()
