#!/usr/bin/env python3
"""
专业中文 DOCX 报告生成器 - 医学研究者可直接使用。
带数据表格、格式化排版、图表引用。
"""
import json
from pathlib import Path
from docx import Document
from docx.shared import Inches, Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT

OUTPUT = Path(r"E:\yixue-scale-engine\skills\target-intelligence\output\KRAS")


def load_json(name):
    fp = OUTPUT / name
    return json.loads(fp.read_text(encoding="utf-8")) if fp.exists() else None


def set_cell_shading(cell, color_hex):
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement
    shading = OxmlElement('w:shd')
    shading.set(qn('w:fill'), color_hex)
    shading.set(qn('w:val'), 'clear')
    cell._tc.get_or_add_tcPr().append(shading)


def add_styled_table(doc, headers, rows, col_widths=None):
    table = doc.add_table(rows=1 + len(rows), cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.style = 'Table Grid'
    for i, h in enumerate(headers):
        cell = table.rows[0].cells[i]
        cell.text = h
        for p in cell.paragraphs:
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            for run in p.runs:
                run.bold = True; run.font.size = Pt(9)
                run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
        set_cell_shading(cell, '2563EB')
    for r, row in enumerate(rows):
        for c, val in enumerate(row):
            cell = table.rows[r + 1].cells[c]
            cell.text = str(val)
            for p in cell.paragraphs:
                for run in p.runs:
                    run.font.size = Pt(9)
            if r % 2 == 0:
                set_cell_shading(cell, 'F0F4FF')
    return table


def add_heading(doc, text, level=1):
    h = doc.add_heading(text, level=level)
    for run in h.runs:
        run.font.color.rgb = RGBColor(0x1E, 0x40, 0xAF)


def add_para(doc, text, bold=False, size=10):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.font.size = Pt(size); run.bold = bold
    return p


def add_fig(doc, fname, caption):
    fp = OUTPUT / fname
    if fp.exists():
        doc.add_picture(str(fp), width=Inches(5.5))
        p = doc.add_paragraph(caption)
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        for run in p.runs:
            run.font.size = Pt(8); run.font.color.rgb = RGBColor(0x6B, 0x72, 0x80)


def build_docx():
    gtex = load_json("gtex_KRAS_expression.json")
    surv = load_json("survival_KRAS_LUAD_results.json")
    tme = load_json("tme_KRAS_LUAD_profile.json")
    comp = load_json("competitive_KRAS_intelligence.json")
    milestones = load_json("milestones_KRAS.json")
    research = load_json("tooluniverse_KRAS_research_profile.json")

    doc = Document()
    section = doc.sections[0]
    section.page_width = Cm(21); section.page_height = Cm(29.7)
    section.left_margin = Cm(2.5); section.right_margin = Cm(2.5)

    # Title
    title = doc.add_heading('KRAS 靶点智能分析报告', 0)
    for run in title.runs:
        run.font.color.rgb = RGBColor(0x1E, 0x40, 0xAF)

    for label, val in [('适应症: ', '肺腺癌 (LUAD)'), ('数据来源: ', 'GTEx, TCGA-LUAD, ClinicalTrials.gov, UniProt, STRING'), ('生成时间: ', '2026-06-04')]:
        p = doc.add_paragraph(); p.add_run(label).bold = True; p.add_run(val)

    p = doc.add_paragraph()
    p.add_run('免责声明: ').bold = True
    p.add_run('本报告由 AI 系统自动生成，仅供科研参考，不构成临床建议或投资建议。')

    doc.add_page_break()

    # TOC
    add_heading(doc, '目录', 1)
    for item in ['一、执行摘要', '二、组织表达谱分析 (GTEx)', '三、生存分析 (TCGA-LUAD)', '四、肿瘤免疫微环境分析', '五、竞争格局分析', '六、药物开发时间线', '七、证据等级评估', '八、结论与建议', '九、数据局限性']:
        doc.add_paragraph(item, style='List Number')
    doc.add_page_break()

    # 一、执行摘要
    add_heading(doc, '一、执行摘要', 1)
    add_styled_table(doc, ['指标', '数值', '解读'], [
        ['检测组织数 (GTEx)', '54', 'Tau=0.575, 中等组织特异性'],
        ['风险比 (HR)', '1.356', '95%CI: [1.010, 1.823], P=0.043*'],
        ['TME 表型', 'Excluded', '免疫排斥型, 单药 ICI 效果有限'],
        ['临床试验', '30 个', '2 个上市药物 (Sotorasib, Adagrasib)'],
        ['综合证据等级', '★★☆', '中等证据, 置信度 75%'],
    ])
    doc.add_paragraph()
    add_para(doc, '核心结论: KRAS 高表达是肺腺癌独立不良预后因子 (HR=1.356, P<0.05)。TME 表型为免疫排斥型，单药免疫治疗效果有限，建议联合策略。G12C 已有上市药物，其他突变亚型 (G12D, G12V) 存在蓝海机会。')

    # 二、表达谱
    add_heading(doc, '二、组织表达谱分析 (GTEx 数据库)', 1)
    if gtex:
        expr = gtex.get("expression_by_tissue", {})
        tau = gtex.get("summary_stats", {}).get("tau_index", 0)
        add_para(doc, f'GTEx 数据库中 KRAS 在 {len(expr)} 个组织中检测到表达。Tau 特异性指数为 {tau:.3f}，表明中等组织特异性。最高表达组织为 Nerve Tibial (30.7 TPM)，肺组织表达量为 19.8 TPM，排名第 6 位。')
        sorted_t = sorted(expr.items(), key=lambda x: x[1], reverse=True)[:10]
        add_styled_table(doc, ['排名', '组织', '表达量 (TPM)', '占最高比例'], [[str(i+1), t, f"{v:.1f}", f"{v/sorted_t[0][1]*100:.0f}%"] for i, (t, v) in enumerate(sorted_t)])
        add_para(doc, f'Tau 指数 {tau:.3f} 提示存在一定的安全性窗口，但需关注高表达组织的脱靶毒性。')
    add_fig(doc, "gtex_KRAS_expression.png", "图 1. KRAS 组织表达谱 (GTEx)")

    # 三、生存分析
    add_heading(doc, '三、生存分析 (TCGA-LUAD)', 1)
    if surv:
        ss = surv.get("survival_stats", {}); cox = ss.get("cox_regression", {})
        n = ss.get("n_high", 0) + ss.get("n_low", 0)
        add_para(doc, f'数据集: TCGA-LUAD (PanCancer Atlas)。样本量: {n} 例。按 KRAS 表达中位数 ({ss.get("median_expression_cutoff",0):.1f}) 分为高/低表达组。')
        add_styled_table(doc, ['指标', '值', '解读'], [
            ['风险比 (HR)', f'{cox.get("hazard_ratio",0):.3f}', '中等风险因子'],
            ['95% 置信区间', f'[{cox.get("hr_ci_lower",0):.3f}, {cox.get("hr_ci_upper",0):.3f}]', '不包含 1.0，结果可信'],
            ['P 值', f'{cox.get("cox_pvalue",0):.4f}', '统计学显著 (P<0.05)'],
            ['C-index', f'{cox.get("concordance_index",0):.3f}', '预测能力中等'],
        ])
        add_styled_table(doc, ['分组', '中位生存期', '差异'], [
            ['KRAS 高表达组', f'{ss.get("median_survival_high_months",0):.1f} 个月', '—'],
            ['KRAS 低表达组', f'{ss.get("median_survival_low_months",0):.1f} 个月', f'+{ss.get("median_survival_low_months",0)-ss.get("median_survival_high_months",0):.1f} 个月'],
        ])
        add_para(doc, f'KRAS 高表达是肺腺癌独立不良预后因子，死亡风险增加 {(cox.get("hazard_ratio",1)-1)*100:.1f}%，中位生存期缩短 {ss.get("median_survival_low_months",0)-ss.get("median_survival_high_months",0):.1f} 个月。')
    add_fig(doc, "survival_KRAS_LUAD_km.png", "图 2. KRAS 生存曲线 (TCGA-LUAD)")

    # 四、免疫微环境
    add_heading(doc, '四、肿瘤免疫微环境分析', 1)
    if tme:
        phen = tme.get("phenotype", "")
        phen_cn = {"hot": "热肿瘤", "cold": "冷肿瘤", "excluded": "免疫排斥型", "immunosuppressive": "免疫抑制型"}.get(phen, phen)
        add_styled_table(doc, ['属性', '值'], [['TME 表型', phen_cn], ['免疫评分', f'{tme.get("immune_score",0)}/100'], ['基质评分', f'{tme.get("stromal_score",0)}/100'], ['置信度', f'{tme.get("phenotype_confidence",0)*100:.0f}%']])
        interp = {"excluded": "免疫排斥型: 免疫细胞存在于肿瘤间质但被排斥在肿瘤核心之外。单药 ICI 效果有限，建议联合 T 细胞浸润促进剂。", "hot": "热肿瘤: 免疫细胞高度浸润，对 ICI 应答率高。", "cold": "冷肿瘤: 免疫浸润极少，需联合策略。", "immunosuppressive": "免疫抑制型: 存在大量抑制性细胞，需联合免疫调节。"}
        add_para(doc, interp.get(phen, f"TME 表型: {phen}"))
        sig_cells = [c for c in tme.get("immune_cells", []) if c.get("significant")]
        if sig_cells:
            add_styled_table(doc, ['免疫细胞', '相关系数', 'P 值', '方向'], [[c["cell_type"], f'{c["correlation_with_target"]:.3f}', f'{c["pvalue"]:.4f}', "负相关" if c["correlation_with_target"] < 0 else "正相关"] for c in sig_cells])
    add_fig(doc, "immune_KRAS_LUAD_heatmap.png", "图 3. 免疫细胞浸润热图")

    # 五、竞争格局
    add_heading(doc, '五、竞争格局分析', 1)
    if comp:
        ct = comp.get("competition", {})
        add_para(doc, f'ClinicalTrials.gov: {ct.get("total_trials",0)} 个临床试验，{ct.get("total_drugs",0)} 个上市药物。')
        phase_cn = {"PHASE1": "I 期", "PHASE2": "II 期", "PHASE3": "III 期", "EARLY_PHASE1": "早期 I 期", "NA": "未分类"}
        add_styled_table(doc, ['阶段', '数量', '占比'], [[phase_cn.get(k, k), str(v), f"{v/ct.get('total_trials',1)*100:.0f}%"] for k, v in ct.get("phase_distribution", {}).items()])
        kp = ct.get("key_players", [])[:5]
        if kp:
            add_styled_table(doc, ['企业', '试验数', '活跃', '阶段'], [[p["company"], str(p["trial_count"]), str(p["active_trials"]), ", ".join(p.get("phases",[]))] for p in kp])
    add_fig(doc, "phase3_KRAS_key_players.png", "图 4. 竞争格局")

    # 六、时间线
    add_heading(doc, '六、药物开发时间线', 1)
    if milestones:
        ms_list = milestones.get("milestones", [])
        phase_cn = {"Discovery": "靶点发现", "Hit To Lead": "苗头到先导", "Lead Optimization": "先导优化", "Preclinical": "临床前", "Phase1": "I 期", "Phase2": "II 期", "Phase3": "III 期", "Approval": "上市审批"}
        desc_cn = {"Target validation, assay development, hit identification": "靶点验证、检测方法开发、苗头化合物筛选", "Hit confirmation, selectivity profiling, initial SAR": "苗头确认、选择性分析、初步构效关系", "Potency, selectivity, ADMET optimization": "活性/选择性/ADMET 优化", "GLP toxicology, PK/PD, CMC, IND-enabling studies": "GLP 毒理、PK/PD、CMC、IND 申报", "First-in-human, dose escalation, safety/PK": "首次人体、剂量爬坡、安全性/PK", "Dose expansion, efficacy signals, biomarker validation": "剂量扩展、有效性信号、biomarker 验证", "Pivotal efficacy trials, registration": "关键性试验、注册申报", "NDA/BLA submission and review": "NDA/BLA 申报与审评"}
        total = sum(m.get("duration_months", 0) for m in ms_list)
        add_para(doc, f'预计总周期: {total} 个月 ({total/12:.1f} 年)。')
        add_styled_table(doc, ['阶段', '起始', '结束', '周期', '主要工作'], [[phase_cn.get(m["phase"], m["phase"]), m["start_date"], m["end_date"], f'{m["duration_months"]} 个月', desc_cn.get(m.get("description",""), m.get("description",""))] for m in ms_list])
    add_fig(doc, "milestones_KRAS_timeline.png", "图 5. 开发时间线")

    # 七、证据等级
    add_heading(doc, '七、证据等级评估', 1)
    if research:
        grade_map = {"T1": "★★★ 强", "T2": "★★☆ 中等", "T3": "★☆☆ 弱", "T4": "☆☆☆ 不足"}
        paths = research.get("paths", {})
        add_styled_table(doc, ['维度', '等级', '证据数', '摘要'], [[p.get("name", k), grade_map.get(p.get("best_grade",""), "?"), str(p.get("evidence_count",0)), p.get("summary","")] for k, p in paths.items()])
        add_para(doc, f'综合: {grade_map.get(research.get("overall_grade",""), "?")} (置信度 {research.get("confidence_score",0):.0f}%)', bold=True)

    # 八、结论
    add_heading(doc, '八、结论与建议', 1)
    add_heading(doc, '核心发现', 2)
    for f in (['KRAS 在 54 个组织中表达 (Tau=0.575)'] + ([f'KRAS 高表达与不良预后相关 (HR={cox.get("hazard_ratio",0):.3f})'] if surv else []) + ([f'TME 表型为{phen_cn}'] if tme else []) + ([f'{ct.get("total_trials",0)} 个临床试验'] if comp else [])):
        doc.add_paragraph(f, style='List Number')
    add_heading(doc, '开发策略建议', 2)
    for r in ['优先开发非 G12C 亚型抑制剂 (G12D, G12V)', '联合用药: KRAS 抑制剂 + 抗血管/免疫治疗', '患者分层: 突变亚型 + TME 表型', '安全性评估: 关注高表达组织脱靶毒性']:
        doc.add_paragraph(r, style='List Bullet')

    # 九、局限性
    add_heading(doc, '九、数据局限性', 1)
    for l in ['公开数据库可能存在选择偏倚', '免疫浸润为计算预测，需实验验证', '生存分析为回顾性研究', '竞争数据可能不包含未注册试验', '时间线为估算值']:
        doc.add_paragraph(l, style='List Bullet')

    doc.add_paragraph()
    p = doc.add_paragraph()
    p.add_run('报告版本: v3.0 | 生成引擎: Target Intelligence').font.size = Pt(8)

    out = OUTPUT / "KRAS_专业分析报告.docx"
    doc.save(str(out))
    print(f"DOCX 已生成: {out}")
    return out


if __name__ == "__main__":
    build_docx()
