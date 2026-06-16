"""
图表生成器
生成发表级质量的 PNG/SVG 图表
"""
import os
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm
import seaborn as sns
from pathlib import Path
from typing import Optional

CJK_FONT_CANDIDATES = (
    "Microsoft YaHei",
    "SimHei",
    "SimSun",
    "Noto Sans CJK SC",
    "Noto Sans SC",
    "Source Han Sans SC",
    "Arial Unicode MS",
)


def _register_known_cjk_font_files() -> None:
    """Register common CJK font files that matplotlib may not have cached yet."""
    font_dirs = []
    windir = os.environ.get("WINDIR")
    if windir:
        font_dirs.append(Path(windir) / "Fonts")
    font_dirs.extend(
        [
            Path("C:/Windows/Fonts"),
            Path("/System/Library/Fonts"),
            Path("/Library/Fonts"),
            Path("/usr/share/fonts"),
            Path("/usr/local/share/fonts"),
        ]
    )
    patterns = (
        "msyh*.ttc",
        "simhei.ttf",
        "simsun*.ttc",
        "NotoSansSC*.ttf",
        "Noto Sans SC*.otf",
        "NotoSansCJK*.ttc",
        "SourceHanSans*.otf",
        "SourceHanSans*.ttc",
    )

    seen: set[Path] = set()
    for font_dir in font_dirs:
        if not font_dir.exists():
            continue
        for pattern in patterns:
            for font_file in font_dir.glob(pattern):
                resolved = font_file.resolve()
                if resolved in seen:
                    continue
                seen.add(resolved)
                try:
                    fm.fontManager.addfont(str(resolved))
                except Exception:
                    continue


def _choose_cjk_font() -> str | None:
    override = os.environ.get("MANUSCRIPT_CHART_FONT", "").strip()
    candidates = (override,) + CJK_FONT_CANDIDATES if override else CJK_FONT_CANDIDATES
    available = {font.name for font in fm.fontManager.ttflist}
    for candidate in candidates:
        if candidate in available:
            return candidate
    return None


def configure_chart_fonts() -> str | None:
    """Configure matplotlib/seaborn to render Chinese labels without glyph loss."""
    _register_known_cjk_font_files()
    selected = _choose_cjk_font()

    sns.set_theme(style="whitegrid", palette="muted")

    fallback_fonts = []
    if selected:
        fallback_fonts.append(selected)
    fallback_fonts.extend(font for font in CJK_FONT_CANDIDATES if font != selected)
    fallback_fonts.extend(["DejaVu Sans", "Arial", "sans-serif"])

    plt.rcParams["font.family"] = ["sans-serif"]
    plt.rcParams["font.sans-serif"] = fallback_fonts
    plt.rcParams["axes.unicode_minus"] = False
    return selected


CHART_FONT_FAMILY = configure_chart_fonts()


class ChartGenerator:
    """生成各种分析图表"""

    def __init__(self, output_dir: str, dpi: int = 150):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.dpi = dpi

    def _save(self, fig: plt.Figure, filename: str, formats: list[str] = None) -> dict:
        """保存图表到文件"""
        if formats is None:
            formats = ["png", "svg"]
        paths = {}
        for fmt in formats:
            path = self.output_dir / f"{filename}.{fmt}"
            fig.savefig(path, dpi=self.dpi, bbox_inches='tight', facecolor='white',
                       format=fmt, metadata={'Creator': 'Drug Target Research Platform'})
            paths[fmt] = str(path)
        plt.close(fig)
        return paths

    def tissue_expression_bar(
        self,
        tissues: dict[str, float],
        gene_symbol: str,
        top_n: int = 15,
        title: str = None
    ) -> dict:
        """
        组织表达条形图（GTEx）

        Args:
            tissues: {tissue_name: tpm_value}
            gene_symbol: 基因符号
            top_n: 显示前N个组织
        """
        sorted_tissues = sorted(tissues.items(), key=lambda x: x[1], reverse=True)[:top_n]
        names = [t[0] for t in sorted_tissues]
        values = [t[1] for t in sorted_tissues]

        fig, ax = plt.subplots(figsize=(10, max(6, len(names) * 0.4)))
        colors = ['#e74c3c' if v > 10 else '#3498db' if v > 5 else '#95a5a6' for v in values]
        bars = ax.barh(range(len(names)), values, color=colors, edgecolor='white', linewidth=0.5)

        ax.set_yticks(range(len(names)))
        ax.set_yticklabels(names, fontsize=10)
        ax.invert_yaxis()
        ax.set_xlabel('TPM (Transcripts Per Million)', fontsize=11)
        ax.set_title(title or f'{gene_symbol} — Normal Tissue Expression (GTEx)', fontsize=13, fontweight='bold')

        # 添加数值标签
        for bar, val in zip(bars, values):
            ax.text(bar.get_width() + 0.3, bar.get_y() + bar.get_height()/2,
                   f'{val:.1f}', va='center', fontsize=9, color='#555')

        # 阈值线
        ax.axvline(x=10, color='#e74c3c', linestyle='--', alpha=0.5, label='High expression (10 TPM)')
        ax.legend(loc='lower right', fontsize=9)

        ax.spines['top'].set_visible(False)
        ax.spines['right'].set_visible(False)
        fig.tight_layout()
        return self._save(fig, f"gtex_{gene_symbol}_expression")

    def survival_kaplan_meier(
        self,
        time_high: list[float],
        event_high: list[int],
        time_low: list[float],
        event_low: list[int],
        gene_symbol: str,
        cancer_type: str,
        hr: float = None,
        p_value: float = None
    ) -> dict:
        """Kaplan-Meier 生存曲线"""
        from lifelines import KaplanMeierFitter

        fig, ax = plt.subplots(figsize=(8, 6))

        kmf_high = KaplanMeierFitter()
        kmf_high.fit(time_high, event_high, label='High Expression')
        kmf_high.plot_survival_function(ax=ax, color='#e74c3c', linewidth=2)

        kmf_low = KaplanMeierFitter()
        kmf_low.fit(time_low, event_low, label='Low Expression')
        kmf_low.plot_survival_function(ax=ax, color='#3498db', linewidth=2)

        ax.set_xlabel('Time (months)', fontsize=11)
        ax.set_ylabel('Survival Probability', fontsize=11)
        ax.set_title(f'{gene_symbol} — Overall Survival ({cancer_type})', fontsize=13, fontweight='bold')

        # HR 和 p 值标注
        if hr is not None and p_value is not None:
            text = f'HR = {hr:.2f}\nP = {p_value:.4f}'
            ax.text(0.98, 0.98, text, transform=ax.transAxes, fontsize=11,
                   verticalalignment='top', horizontalalignment='right',
                   bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.8))

        ax.set_ylim(0, 1.05)
        ax.spines['top'].set_visible(False)
        ax.spines['right'].set_visible(False)
        ax.grid(True, alpha=0.3)
        fig.tight_layout()
        return self._save(fig, f"survival_{gene_symbol}_{cancer_type}_km")

    def immune_correlation_heatmap(
        self,
        correlations: dict[str, dict],
        gene_symbol: str,
        cancer_type: str
    ) -> dict:
        """免疫细胞相关性热图"""
        cells = list(correlations.keys())
        corr_values = [correlations[c]["correlation"] for c in cells]
        p_values = [correlations[c]["p_value"] for c in cells]

        fig, ax = plt.subplots(figsize=(8, max(4, len(cells) * 0.5)))

        # 构建热图数据
        data = np.array(corr_values).reshape(-1, 1)
        cell_labels = [c.replace('_', ' ') for c in cells]

        # 显著性标记
        annotations = []
        for i, (corr, pval) in enumerate(zip(corr_values, p_values)):
            sig = "***" if pval < 0.001 else "**" if pval < 0.01 else "*" if pval < 0.05 else ""
            annotations.append(f"{corr:+.3f}{sig}")

        cmap = sns.diverging_palette(220, 10, as_cmap=True)
        sns.heatmap(data, annot=np.array(annotations).reshape(-1, 1),
                   fmt='', cmap=cmap, center=0, vmin=-1, vmax=1,
                   xticklabels=[gene_symbol], yticklabels=cell_labels,
                   linewidths=0.5, linecolor='white', ax=ax,
                   cbar_kws={'label': 'Spearman ρ', 'shrink': 0.8})

        ax.set_title(f'{gene_symbol} — Immune Cell Correlation ({cancer_type})\n* p<0.05, ** p<0.01, *** p<0.001',
                    fontsize=12, fontweight='bold')
        fig.tight_layout()
        return self._save(fig, f"immune_{gene_symbol}_{cancer_type}_heatmap")

    def druggability_radar(
        self,
        targets: list[dict],
        title: str = "Target Druggability Comparison"
    ) -> dict:
        """成药性雷达图"""
        categories = ['DE Score', 'Drug Count', 'Clinical Phase', 'Literature', 'Safety Data']
        n_cats = len(categories)
        angles = np.linspace(0, 2 * np.pi, n_cats, endpoint=False).tolist()
        angles += angles[:1]

        fig, ax = plt.subplots(figsize=(8, 8), subplot_kw=dict(polar=True))
        colors = sns.color_palette("husl", len(targets))

        for i, target in enumerate(targets[:5]):
            values = [
                target.get('de_score', 0),
                min(target.get('drug_count', 0) / 100, 1.0),
                target.get('max_phase', 0) / 4,
                min(target.get('literature_count', 0) / 10000, 1.0),
                target.get('safety_score', 0.5)
            ]
            values += values[:1]
            ax.plot(angles, values, 'o-', linewidth=2, color=colors[i], label=target.get('gene', ''))
            ax.fill(angles, values, alpha=0.1, color=colors[i])

        ax.set_xticks(angles[:-1])
        ax.set_xticklabels(categories, fontsize=10)
        ax.set_ylim(0, 1)
        ax.set_title(title, fontsize=13, fontweight='bold', pad=20)
        ax.legend(loc='upper right', bbox_to_anchor=(1.3, 1.1), fontsize=9)
        fig.tight_layout()
        return self._save(fig, "druggability_radar")

    # 中文 → 英文阶段名映射
    _PHASE_NAME_MAP = {
        "靶点验证": "Target Validation",
        "先导化合物优化": "Lead Optimization",
        "临床前研究": "Preclinical",
        "I期临床": "Phase I",
        "II期临床": "Phase II",
        "III期临床": "Phase III",
        "上市申请": "Registration",
    }

    def milestone_gantt(
        self,
        phases: list[dict],
        target_name: str
    ) -> dict:
        """里程碑甘特图"""
        fig, ax = plt.subplots(figsize=(12, max(4, len(phases) * 0.8)))
        colors = ['#27ae60', '#2980b9', '#8e44ad', '#e67e22', '#c0392b', '#1abc9c']

        cumulative = 0
        for i, phase in enumerate(phases):
            duration = phase.get('duration_months', 12)
            cost = phase.get('cost', 0)
            sr = phase.get('success_rate', 0.5)
            color = colors[i % len(colors)]

            bar = ax.barh(i, duration, left=cumulative, height=0.6,
                         color=color, edgecolor='white', linewidth=1, alpha=0.85)

            # 标注
            label = f"{duration}mo | ${cost}M | {sr*100:.0f}%"
            ax.text(cumulative + duration/2, i, label,
                   ha='center', va='center', fontsize=9, color='white', fontweight='bold')

            cumulative += duration

        ax.set_yticks(range(len(phases)))
        labels = []
        for p in phases:
            name = p.get('name', '')
            labels.append(self._PHASE_NAME_MAP.get(name, name))
        ax.set_yticklabels(labels, fontsize=10)
        ax.invert_yaxis()
        ax.set_xlabel('Months', fontsize=11)
        ax.set_title(f'{target_name} — Development Milestones', fontsize=13, fontweight='bold')

        # 总计
        total_months = sum(p.get('duration_months', 0) for p in phases)
        total_cost = sum(p.get('cost', 0) for p in phases)
        ax.text(0.98, 0.02, f'Total: {total_months}mo | ${total_cost}M',
               transform=ax.transAxes, fontsize=11, ha='right',
               bbox=dict(boxstyle='round', facecolor='lightyellow', alpha=0.9))

        ax.spines['top'].set_visible(False)
        ax.spines['right'].set_visible(False)
        ax.grid(axis='x', alpha=0.3)
        fig.tight_layout()
        return self._save(fig, f"milestones_{target_name}_timeline")

    def volcano_plot(
        self,
        genes: list[dict],
        gene_symbol: str = None,
        title: str = "Differential Expression Volcano Plot"
    ) -> dict:
        """火山图"""
        fig, ax = plt.subplots(figsize=(8, 6))

        log2fc = [g.get('log2fc', 0) for g in genes]
        pvals = [g.get('p_value', 1) for g in genes]
        neg_log_p = [-np.log10(max(p, 1e-300)) for p in pvals]

        # 分类
        colors = []
        for fc, p in zip(log2fc, pvals):
            if abs(fc) > 1 and p < 0.05:
                colors.append('#e74c3c' if fc > 0 else '#3498db')
            else:
                colors.append('#bdc3c7')

        ax.scatter(log2fc, neg_log_p, c=colors, alpha=0.6, s=20, edgecolors='none')

        # 标注目标基因
        if gene_symbol:
            for g in genes:
                if g.get('gene') == gene_symbol:
                    ax.annotate(gene_symbol,
                              (g.get('log2fc', 0), -np.log10(max(g.get('p_value', 1), 1e-300))),
                              fontsize=10, fontweight='bold', color='#c0392b',
                              arrowprops=dict(arrowstyle='->', color='#c0392b'))

        ax.axhline(-np.log10(0.05), color='gray', linestyle='--', alpha=0.5, label='p=0.05')
        ax.axvline(-1, color='gray', linestyle='--', alpha=0.5)
        ax.axvline(1, color='gray', linestyle='--', alpha=0.5, label='|log2FC|=1')

        ax.set_xlabel('log2 Fold Change', fontsize=11)
        ax.set_ylabel('-log10(p-value)', fontsize=11)
        ax.set_title(title, fontsize=13, fontweight='bold')
        ax.legend(fontsize=9)
        ax.spines['top'].set_visible(False)
        ax.spines['right'].set_visible(False)
        fig.tight_layout()
        return self._save(fig, "volcano_plot")

    def composite_ranking_bar(
        self,
        targets: list[dict],
        title: str = "Composite Target Ranking"
    ) -> dict:
        """综合排名条形图"""
        fig, ax = plt.subplots(figsize=(10, max(5, len(targets) * 0.5)))

        genes = [t['gene'] for t in targets]
        de_scores = [t.get('de_score', 0) for t in targets]
        drug_scores = [t.get('druggability_score', 0) for t in targets]

        y = range(len(genes))
        bar_height = 0.35

        bars1 = ax.barh([i + bar_height/2 for i in y], de_scores, bar_height,
                       label='DE Score (×0.6)', color='#3498db', alpha=0.85)
        bars2 = ax.barh([i - bar_height/2 for i in y], drug_scores, bar_height,
                       label='Druggability (×0.4)', color='#e67e22', alpha=0.85)

        # 综合分数标注
        for i, t in enumerate(targets):
            composite = t.get('composite_score', 0)
            ax.text(max(de_scores[i], drug_scores[i]) + 0.02, i, f'{composite:.3f}',
                   va='center', fontsize=9, fontweight='bold', color='#2c3e50')

        ax.set_yticks(y)
        ax.set_yticklabels(genes, fontsize=10)
        ax.invert_yaxis()
        ax.set_xlabel('Score', fontsize=11)
        ax.set_title(title, fontsize=13, fontweight='bold')
        ax.legend(loc='lower right', fontsize=9)
        ax.spines['top'].set_visible(False)
        ax.spines['right'].set_visible(False)
        ax.set_xlim(0, 1.15)
        fig.tight_layout()
        return self._save(fig, "composite_ranking")

    _PHASE_ZH = {
        "Phase 1": "I 期",
        "Phase 2": "II 期",
        "Phase 3": "III 期",
        "Phase 4": "IV 期",
        "Not Applicable": "观察性/NA",
    }

    def tissue_expression_heatmap(
        self,
        tissues: dict[str, float],
        gene_symbol: str,
        top_n: int = 20,
        tissue_labels_zh: dict[str, str] | None = None,
    ) -> dict:
        """GTEx 组织表达热图（发表级）。"""
        sorted_tissues = sorted(tissues.items(), key=lambda x: x[1], reverse=True)[:top_n]
        if not sorted_tissues:
            return {}

        labels = []
        for name, _ in sorted_tissues:
            zh = (tissue_labels_zh or {}).get(name)
            labels.append(f"{zh}\n({name})" if zh else name.replace("_", " "))
        values = np.array([[v for _, v in sorted_tissues]])

        fig, ax = plt.subplots(figsize=(max(12, top_n * 0.55), 3.2))
        cmap = sns.color_palette("YlOrRd", as_cmap=True)
        sns.heatmap(
            values,
            annot=True,
            fmt=".1f",
            cmap=cmap,
            xticklabels=labels,
            yticklabels=[f"{gene_symbol} TPM"],
            linewidths=0.6,
            linecolor="white",
            cbar_kws={"label": "TPM"},
            ax=ax,
        )
        ax.set_title(f"{gene_symbol} 正常组织表达热图（GTEx，Top {len(sorted_tissues)}）", fontsize=13, fontweight="bold")
        plt.setp(ax.get_xticklabels(), rotation=45, ha="right", fontsize=8)
        fig.tight_layout()
        return self._save(fig, f"heatmap_{gene_symbol}_gtex")

    def clinical_trial_sankey(
        self,
        phase_distribution: dict[str, int],
        status_distribution: dict[str, int] | None,
        target_name: str,
        disease_zh: str,
        total_trials: int | None = None,
    ) -> dict:
        """临床试验阶段—状态流程图（桑基风格，matplotlib 实现）。"""
        if not phase_distribution:
            return {}

        from matplotlib.patches import FancyBboxPatch
        from matplotlib.collections import PatchCollection

        phases = sorted(phase_distribution.items(), key=lambda x: -x[1])
        statuses = sorted((status_distribution or {}).items(), key=lambda x: -x[1])
        total = total_trials or sum(phase_distribution.values())

        fig, ax = plt.subplots(figsize=(13, 6))
        ax.set_xlim(0, 10)
        ax.set_ylim(0, 10)
        ax.axis("off")

        # 左：总量
        ax.add_patch(FancyBboxPatch((0.3, 4), 1.4, 2, boxstyle="round,pad=0.05", facecolor="#34495e", edgecolor="white"))
        ax.text(1.0, 5.0, f"注册试验\nN={total}", ha="center", va="center", color="white", fontsize=11, fontweight="bold")

        # 中：阶段
        y_start = 8.5
        bar_h = 0.55
        gap = 0.15
        max_count = max(c for _, c in phases) or 1
        for i, (phase, count) in enumerate(phases):
            y = y_start - i * (bar_h + gap)
            w = 1.5 + 2.5 * (count / max_count)
            label = self._PHASE_ZH.get(phase, phase)
            ax.add_patch(FancyBboxPatch((3.0, y), w, bar_h, boxstyle="round,pad=0.02", facecolor="#3498db", alpha=0.85))
            ax.text(3.1, y + bar_h / 2, f"{label} ({count})", va="center", fontsize=9, color="white", fontweight="bold")
            # 连接线
            ax.annotate("", xy=(3.0, y + bar_h / 2), xytext=(1.7, 5.0),
                        arrowprops=dict(arrowstyle="-", color="#95a5a6", lw=1.2, alpha=0.5))

        # 右：状态
        if statuses:
            y2 = 8.5
            max_s = max(c for _, c in statuses) or 1
            for i, (status, count) in enumerate(statuses[:8]):
                y = y2 - i * (bar_h + gap)
                w = 1.2 + 2.0 * (count / max_s)
                ax.add_patch(FancyBboxPatch((7.0, y), w, bar_h, boxstyle="round,pad=0.02", facecolor="#e67e22", alpha=0.85))
                ax.text(7.1, y + bar_h / 2, f"{status} ({count})", va="center", fontsize=8, color="white")
                mid_phase_y = y_start - (len(phases) // 2) * (bar_h + gap)
                ax.annotate("", xy=(7.0, y + bar_h / 2), xytext=(5.5, mid_phase_y + bar_h / 2),
                            arrowprops=dict(arrowstyle="-", color="#bdc3c7", lw=0.8, alpha=0.4))

        ax.set_title(
            f"{target_name} / {disease_zh} — 临床试验阶段与状态流程图",
            fontsize=13,
            fontweight="bold",
            pad=12,
        )
        fig.tight_layout()
        slug = f"sankey_{target_name}_{disease_zh.replace(' ', '_')}"
        return self._save(fig, slug)

    def tumor_expression_distribution(
        self,
        sample_values: list[float],
        gene_symbol: str,
        cancer_type: str = "BRCA",
    ) -> dict:
        """TCGA 肿瘤表达分布图。"""
        if not sample_values:
            return {}
        fig, ax = plt.subplots(figsize=(8, 4.5))
        sns.histplot(sample_values, bins=40, kde=True, color="#8e44ad", ax=ax, edgecolor="white")
        median = float(np.median(sample_values))
        ax.axvline(median, color="#c0392b", linestyle="--", linewidth=1.5, label=f"中位数 {median:.0f}")
        ax.set_xlabel("RSEM 表达值", fontsize=11)
        ax.set_ylabel("样本数", fontsize=11)
        ax.set_title(f"TCGA-{cancer_type} {gene_symbol} 肿瘤表达分布 (n={len(sample_values)})", fontsize=12, fontweight="bold")
        ax.legend()
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        fig.tight_layout()
        return self._save(fig, f"tumor_expr_{gene_symbol}_{cancer_type}")
