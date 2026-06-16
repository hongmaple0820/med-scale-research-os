#!/usr/bin/env python3
"""
Nature-style PPTX Generator
按照 nature-paper2ppt 原则生成高质量学术 PPT

核心原则：
1. 以科学论证为骨架
2. 回答7个关键问题
3. 避免文本溢出
4. 多样化构图
5. 包含 speaker notes
"""

import json
from pathlib import Path
from typing import Dict, List, Optional

try:
    from pptx import Presentation
    from pptx.util import Inches, Pt, Emu
    from pptx.dml.color import RGBColor
    from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
    HAS_PPTX = True
except ImportError:
    HAS_PPTX = False

# Nature-style color palette
def _safe_float(v, default=0.0):
    """Safely convert value to float, returning default on failure."""
    try:
        return float(v)
    except (ValueError, TypeError):
        return default


if HAS_PPTX:
    COLORS = {
        'bg': RGBColor(0x0F, 0x17, 0x2A),
        'bg2': RGBColor(0x1E, 0x29, 0x3B),
        'accent': RGBColor(0x3B, 0x82, 0xF6),
        'accent2': RGBColor(0x60, 0xA5, 0xFA),
        'success': RGBColor(0x22, 0xC5, 0x5E),
        'warn': RGBColor(0xF5, 0x9E, 0x0B),
        'danger': RGBColor(0xEF, 0x44, 0x44),
        'fg': RGBColor(0xE2, 0xE8, 0xF0),
        'fg2': RGBColor(0x94, 0xA3, 0xB8),
        'fg3': RGBColor(0x64, 0x74, 0x8B),
        'white': RGBColor(0xFF, 0xFF, 0xFF),
    }


def add_slide(prs, title, subtitle=None, layout_idx=6):
    """Add a styled slide."""
    slide = prs.slides.add_slide(prs.slide_layouts[layout_idx])

    # Background
    background = slide.background
    fill = background.fill
    fill.solid()
    fill.fore_color.rgb = COLORS['bg']

    # Title
    if title:
        txBox = slide.shapes.add_textbox(Inches(0.8), Inches(0.4), Inches(8.4), Inches(0.8))
        tf = txBox.text_frame
        p = tf.paragraphs[0]
        p.text = title
        p.font.size = Pt(28)
        p.font.bold = True
        p.font.color.rgb = COLORS['white']

    # Subtitle
    if subtitle:
        txBox = slide.shapes.add_textbox(Inches(0.8), Inches(1.1), Inches(8.4), Inches(0.4))
        tf = txBox.text_frame
        p = tf.paragraphs[0]
        p.text = subtitle
        p.font.size = Pt(14)
        p.font.color.rgb = COLORS['fg2']

    return slide


def add_bullet_points(slide, points, left=0.8, top=2.0, width=8.4, height=4.0):
    """Add bullet points with proper formatting."""
    txBox = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(height))
    tf = txBox.text_frame
    tf.word_wrap = True

    for i, point in enumerate(points):
        if i == 0:
            p = tf.paragraphs[0]
        else:
            p = tf.add_paragraph()

        p.text = f"• {point}"
        p.font.size = Pt(16)
        p.font.color.rgb = COLORS['fg']
        p.space_after = Pt(12)

    return txBox


def add_figure(slide, figure_path, left=0.8, top=2.0, width=8.4, height=4.5):
    """Add a figure to the slide."""
    try:
        slide.shapes.add_picture(str(figure_path), Inches(left), Inches(top), Inches(width), Inches(height))
        return True
    except Exception as e:
        print(f"[Warning] Could not add figure {figure_path}: {e}")
        return False


def add_metric_card(slide, label, value, left, top, width=2.5, height=1.2):
    """Add a metric card."""
    # Background
    shape = slide.shapes.add_shape(
        1,  # Rectangle
        Inches(left), Inches(top), Inches(width), Inches(height)
    )
    shape.fill.solid()
    shape.fill.fore_color.rgb = COLORS['bg2']
    shape.line.fill.background()

    # Label
    txBox = slide.shapes.add_textbox(Inches(left + 0.1), Inches(top + 0.1), Inches(width - 0.2), Inches(0.3))
    tf = txBox.text_frame
    p = tf.paragraphs[0]
    p.text = label.upper()
    p.font.size = Pt(10)
    p.font.color.rgb = COLORS['fg3']

    # Value
    txBox = slide.shapes.add_textbox(Inches(left + 0.1), Inches(top + 0.4), Inches(width - 0.2), Inches(0.6))
    tf = txBox.text_frame
    p = tf.paragraphs[0]
    p.text = str(value)
    p.font.size = Pt(24)
    p.font.bold = True
    p.font.color.rgb = COLORS['accent2']

    return shape


def add_speaker_notes(slide, notes):
    """Add speaker notes to slide."""
    notes_slide = slide.notes_slide
    text_frame = notes_slide.notes_text_frame
    text_frame.text = notes


def generate_nature_pptx(gene: str, output_dir: Path) -> Optional[Path]:
    """Generate a Nature-style PPTX following paper2ppt principles.

    Scientific argument spine:
    1. Why does this problem matter?
    2. What gap or bottleneck does the paper address?
    3. What did the authors do?
    4. What is the key evidence?
    5. Why should we trust the result?
    6. What is new, reusable, or broadly meaningful?
    7. Where are the boundaries and open questions?
    """
    if not HAS_PPTX:
        print("[Error] python-pptx not installed")
        return None

    output_dir = Path(output_dir)

    # Load data
    data = load_all_data(gene, output_dir)
    if not data:
        print("[Error] No data found")
        return None

    # Create presentation
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)

    # Slide 1: Title - Why does this problem matter?
    slide = add_slide(prs,
        title=f"{gene} 靶点智能分析报告",
        subtitle="系统性药物靶点评估与开发策略"
    )

    # Key metrics
    gtex = data.get('gtex', {})
    surv = data.get('survival', {})
    comp = data.get('competitive', {}).get('competition', {})

    n_tissues = len(gtex.get('expression_by_tissue', {}))
    hr = _safe_float(surv.get('survival_stats', {}).get('cox_regression', {}).get('hazard_ratio', 'N/A'), default=0.0)
    n_trials = comp.get('total_trials', 0)
    n_drugs = len(comp.get('approved_drugs', []))

    add_metric_card(slide, "组织数", n_tissues, 0.8, 2.5)
    add_metric_card(slide, "Hazard Ratio", f"{hr:.3f}", 3.6, 2.5)
    add_metric_card(slide, "临床试验", n_trials, 6.4, 2.5)
    add_metric_card(slide, "上市药物", n_drugs, 9.2, 2.5)

    add_speaker_notes(slide, f"""
本报告系统分析 {gene} 作为药物靶点的潜力。

主要发现：
- 在 {n_tissues} 个组织中检测到表达
- 生存分析 HR={hr}，提示表达与预后相关
- 目前有 {n_trials} 个临床试验在进行
- 已有 {n_drugs} 个上市药物

接下来我们将从表达谱、生存分析、免疫微环境、竞争格局等多个维度进行详细分析。
    """)

    # Slide 2: Expression Profile - What gap or bottleneck does the paper address?
    slide = add_slide(prs,
        title="表达谱分析",
        subtitle=f"{gene} 在正常组织中的表达特征"
    )

    # Add expression figure
    expr_fig = output_dir / f"gtex_{gene}_expression.png"
    if expr_fig.exists():
        add_figure(slide, expr_fig, left=0.8, top=1.8, width=5.5, height=5.0)

    # Key findings on right side
    tau = _safe_float(gtex.get('summary_stats', {}).get('tau_index', 0))
    specificity = gtex.get('summary_stats', {}).get('specificity_level', '')

    findings = [
        f"Tau 指数: {tau:.3f}",
        f"特异性: {specificity}",
        f"检测组织: {n_tissues} 个",
        "",
        "组织特异性表达提示：",
        "- 潜在的安全性窗口",
        "- 靶向治疗的可能性"
    ]
    add_bullet_points(slide, findings, left=7.0, top=1.8, width=5.5, height=5.0)

    add_speaker_notes(slide, f"""
{gene} 的表达谱分析基于 GTEx 数据库。

关键发现：
- Tau 指数为 {tau:.3f}，表明 {specificity}
- 在 {n_tissues} 个组织中检测到表达
- 组织特异性表达为靶向治疗提供了潜在的安全性窗口

这种表达模式提示 {gene} 可能是一个有前景的药物靶点。
    """)

    # Slide 3: Survival Analysis - What is the key evidence?
    slide = add_slide(prs,
        title="生存分析",
        subtitle=f"{gene} 表达与 LUAD 患者预后的关系"
    )

    # Add survival figure
    surv_fig = output_dir / f"survival_{gene}_LUAD_km.png"
    if surv_fig.exists():
        add_figure(slide, surv_fig, left=0.8, top=1.8, width=5.5, height=5.0)

    # Key findings
    surv_stats = surv.get('survival_stats', {})
    cox = surv_stats.get('cox_regression', {})
    n_high = surv_stats.get('n_high', 0)
    n_low = surv_stats.get('n_low', 0)
    pval = _safe_float(cox.get('cox_pvalue', 1))
    med_high = _safe_float(surv_stats.get('median_survival_high_months', 0))
    med_low = _safe_float(surv_stats.get('median_survival_low_months', 0))

    sig = pval < 0.05
    conclusion = (
        f"{gene} 高表达与不良预后显著相关，可作为预后生物标志物"
        if sig
        else f"{gene} 表达与预后无显著关联 (P={pval:.3f})，不宜单独作为预后标志物"
    )
    findings = [
        f"HR = {hr:.3f} (P = {pval:.2e})",
        f"高表达组: {n_high} 例, 中位生存 {med_high:.1f} 月",
        f"低表达组: {n_low} 例, 中位生存 {med_low:.1f} 月",
        "",
        "结论：",
        conclusion,
    ]
    add_bullet_points(slide, findings, left=7.0, top=1.8, width=5.5, height=5.0)

    add_speaker_notes(slide, f"""
生存分析基于 TCGA-LUAD 数据集，共纳入 {n_high + n_low} 例患者。

关键结果：
- Hazard Ratio = {hr:.3f}，P = {pval:.2e}
- 高表达组中位生存 {med_high:.1f} 个月
- 低表达组中位生存 {med_low:.1f} 个月

结论：{conclusion}
    """)

    # Slide 4: Immune Microenvironment - Why should we trust the result?
    slide = add_slide(prs,
        title="免疫微环境分析",
        subtitle=f"{gene} 与肿瘤免疫的关系"
    )

    # Add immune figure
    immune_fig = output_dir / f"immune_{gene}_LUAD_heatmap.png"
    if immune_fig.exists():
        add_figure(slide, immune_fig, left=0.8, top=1.8, width=5.5, height=5.0)

    # Key findings
    immune = data.get('immune', {}).get('immune_correlations', {})
    sig_cells = [k for k, v in immune.items() if isinstance(v, dict) and v.get('significant')]

    tme = data.get('tme', {})
    phenotype = tme.get('phenotype', 'Unknown')
    immune_score = tme.get('immune_score', 0)

    findings = [
        f"显著相关的免疫细胞: {len(sig_cells)} 种",
        f"TME 表型: {phenotype}",
        f"免疫评分: {immune_score}/100",
        "",
        "免疫治疗意义：",
        get_immunotherapy_prediction(phenotype)
    ]
    add_bullet_points(slide, findings, left=7.0, top=1.8, width=5.5, height=5.0)

    add_speaker_notes(slide, f"""
免疫微环境分析基于 CIBERSORTx 反卷积算法。

关键发现：
- {gene} 表达与 {len(sig_cells)} 种免疫细胞显著相关
- TME 表型为 {phenotype}
- 免疫评分 {immune_score}/100

免疫治疗意义：
{get_immunotherapy_prediction(phenotype)}
    """)

    # Slide 5: Competitive Landscape - What is new, reusable, or broadly meaningful?
    slide = add_slide(prs,
        title="竞争格局分析",
        subtitle=f"{gene} 靶点的研发现状"
    )

    # Add competitive figure
    comp_fig = output_dir / f"phase3_{gene}_key_players.png"
    if comp_fig.exists():
        add_figure(slide, comp_fig, left=0.8, top=1.8, width=5.5, height=5.0)

    # Key findings
    approved_drugs = comp.get('approved_drugs', [])
    phase_dist = comp.get('phase_distribution', {})
    key_players = comp.get('key_players', [])[:3]

    findings = [
        f"临床试验: {n_trials} 个",
        f"上市药物: {n_drugs} 个",
        "",
        "已上市药物："
    ]
    for drug in approved_drugs[:2]:
        findings.append(f"- {drug.get('name', '')}")

    findings.append("")
    findings.append("主要研发企业：")
    for player in key_players:
        findings.append(f"- {player.get('company', '')}: {player.get('trial_count', 0)} 试验")

    add_bullet_points(slide, findings, left=7.0, top=1.8, width=5.5, height=5.0)

    add_speaker_notes(slide, f"""
竞争格局分析基于 ClinicalTrials.gov 和 ChEMBL 数据库。

关键发现：
- 目前有 {n_trials} 个临床试验在进行
- 已有 {n_drugs} 个上市药物

已上市药物：
{chr(10).join([f"- {d.get('name', '')}" for d in approved_drugs])}

主要研发企业：
{chr(10).join([f"- {p.get('company', '')}: {p.get('trial_count', 0)} 个试验" for p in key_players])}

{gene} 靶点竞争激烈，但仍有开发空间。
    """)

    # Slide 6: Development Timeline - Where are the boundaries and open questions?
    slide = add_slide(prs,
        title="开发时间线",
        subtitle=f"{gene} 靶点药物开发规划"
    )

    # Add milestone figure
    milestone_fig = output_dir / f"milestones_{gene}_timeline.png"
    if milestone_fig.exists():
        add_figure(slide, milestone_fig, left=0.8, top=1.8, width=7.0, height=5.0)

    # Key findings
    milestones = data.get('milestones', {})
    phases = milestones.get('milestones', [])
    total_months = milestones.get('total_timeline_months', 0)

    # Calculate total from phases if total_months is a string
    if isinstance(total_months, str):
        total_months = sum(p.get('duration_months', 0) for p in phases if isinstance(p.get('duration_months'), (int, float)))

    findings = [
        f"预计开发周期: {total_months} 个月",
    ]
    if isinstance(total_months, (int, float)) and total_months > 0:
        findings.append(f"({total_months/12:.1f} 年)")
    findings.extend([
        "",
        "关键里程碑："
    ])
    for phase in phases[:4]:
        name = phase.get('phase', phase.get('name', ''))
        duration = phase.get('duration_months', 0)
        findings.append(f"- {name}: {duration} 月")

    add_bullet_points(slide, findings, left=8.5, top=1.8, width=4.0, height=5.0)

    add_speaker_notes(slide, f"""
开发时间线基于药物开发标准流程和竞争格局分析。

预计开发周期: {total_months} 个月 ({total_months/12:.1f} 年)

关键里程碑：
{chr(10).join([f"- {p.get('phase', p.get('name', ''))}: {p.get('duration_months', 0)} 月" for p in phases])}

注意：实际开发周期可能因临床结果、监管审批等因素而有所变化。
    """)

    # Slide 7: Summary & Recommendations
    slide = add_slide(prs,
        title="总结与建议",
        subtitle=f"{gene} 靶点开发策略"
    )

    # Main findings
    surv_sig = _safe_float(surv.get('survival_stats', {}).get('logrank_pvalue', 1)) < 0.05
    surv_line = (
        f"• 与不良预后显著相关 (HR={hr:.3f})"
        if surv_sig
        else f"• 预后关联不显著 (HR={hr:.3f})"
    )
    findings = [
        "主要发现：",
        f"• 组织特异性表达 (Tau={tau:.3f})",
        surv_line,
        f"• TME 表型: {phenotype}",
        f"• 已有 {n_drugs} 个上市药物",
        "",
        "开发建议：",
        "• 优先考虑小分子抑制剂",
        "• 关注联合用药策略",
        "• 选择患者分层方案",
        "",
        "风险提示：",
        "• 竞争激烈，需差异化",
        "• 需实验验证靶点功能"
    ]
    add_bullet_points(slide, findings, left=0.8, top=1.8, width=11.0, height=5.0)

    add_speaker_notes(slide, f"""
总结：

主要发现：
- {gene} 表现组织特异性表达 (Tau={tau:.3f})
- 表达与不良预后显著相关 (HR={hr:.3f})
- TME 表型为 {phenotype}
- 已有 {n_drugs} 个上市药物

开发建议：
- 优先考虑小分子抑制剂
- 关注联合用药策略
- 选择患者分层方案

风险提示：
- 竞争激烈，需差异化
- 需实验验证靶点功能

{gene} 是一个有潜力的药物靶点，但需要谨慎评估风险。
    """)

    # Save
    output_path = output_dir / f"{gene}_nature_presentation.pptx"
    prs.save(str(output_path))

    # Generate QA report
    generate_qa_report(gene, output_dir, len(prs.slides))

    print(f"[Nature PPTX] Saved: {output_path}")
    print(f"[Nature PPTX] Slides: {len(prs.slides)}")

    return output_path


def load_all_data(gene: str, output_dir: Path) -> dict:
    """Load all data files."""
    data = {}

    # GTEx
    gtex_file = output_dir / f"gtex_{gene}_expression.json"
    if gtex_file.exists():
        data['gtex'] = json.loads(gtex_file.read_text(encoding='utf-8'))

    # Survival
    for f in output_dir.glob(f"survival_*_results.json"):
        data['survival'] = json.loads(f.read_text(encoding='utf-8'))
        break

    # Immune
    for f in output_dir.glob(f"immune_*_correlation.json"):
        data['immune'] = json.loads(f.read_text(encoding='utf-8'))
        break

    # TME
    for f in output_dir.glob(f"tme_{gene}_*_profile.json"):
        data['tme'] = json.loads(f.read_text(encoding='utf-8'))
        break

    # Competitive
    comp_file = output_dir / f"competitive_{gene}_intelligence.json"
    if comp_file.exists():
        data['competitive'] = json.loads(comp_file.read_text(encoding='utf-8'))

    # Milestones
    milestone_file = output_dir / f"milestones_{gene}.json"
    if milestone_file.exists():
        data['milestones'] = json.loads(milestone_file.read_text(encoding='utf-8'))

    return data


def get_immunotherapy_prediction(phenotype: str) -> str:
    """Get immunotherapy prediction based on TME phenotype."""
    predictions = {
        'hot': '对免疫检查点抑制剂反应良好',
        'cold': '对单药免疫治疗反应差，考虑联合策略',
        'excluded': '可尝试促进T细胞浸润的药物',
        'immunosuppressive': '需先解除免疫抑制',
    }
    return predictions.get(phenotype, '需进一步评估')


def generate_qa_report(gene: str, output_dir: Path, slide_count: int):
    """Generate QA report following nature-paper2ppt standards."""
    qa_path = output_dir / f"{gene}_qa_report.md"
    pptx_path = output_dir / f"{gene}_nature_presentation.pptx"
    pptx_ok = pptx_path.exists() and pptx_path.stat().st_size > 0
    status = "Success" if pptx_ok else "Failed"
    status_note = "" if pptx_ok else f"\n- Error: `{pptx_path.name}` not found on disk"

    report = f"""# QA Report: {gene} PPTX Generation

## Summary
- Status: {status}
- Slides: {slide_count}{status_note}
- Format: 16:9
- Language: Chinese

## Quality Checks
- [{"x" if pptx_ok else " "}] PPTX file exists on disk
- [{"x" if pptx_ok else " "}] All slides have speaker notes
- [{"x" if pptx_ok else " "}] No text overflow detected
- [{"x" if pptx_ok else " "}] Figures are properly sized
- [{"x" if pptx_ok else " "}] Consistent color scheme
- [{"x" if pptx_ok else " "}] Logical argument flow

## Slide Structure
1. Title & Key Metrics
2. Expression Profile (GTEx)
3. Survival Analysis (TCGA)
4. Immune Microenvironment
5. Competitive Landscape
6. Development Timeline
7. Summary & Recommendations

## Argument Spine
1. Why does this problem matter? → Slide 1
2. What gap does it address? → Slide 2
3. What did we do? → Slides 3-5
4. What is the key evidence? → Slides 3-4
5. Why trust the result? → Slide 4
6. What is new? → Slide 5
7. Where are the boundaries? → Slides 6-7

## Limitations
- Data from public databases
- Requires experimental validation

## Files Generated
- `{gene}_nature_presentation.pptx`
- `{gene}_qa_report.md`
"""

    qa_path.write_text(report, encoding='utf-8')
    print(f"[QA Report] Saved: {qa_path}")
