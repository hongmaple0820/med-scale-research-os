"""
Unified visualization module for target intelligence.
Generates publication-quality figures using matplotlib + seaborn.
"""

from pathlib import Path
from typing import Dict, List, Optional, Tuple

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker
import numpy as np

# Nature-style 图表规范（借鉴 nature-skills 的 nature-figure）
NATURE_STYLE = {
    'font.family': 'sans-serif',
    'font.sans-serif': ['Arial', 'Helvetica', 'DejaVu Sans'],
    'font.size': 7,
    'axes.linewidth': 0.5,
    'axes.labelsize': 7,
    'axes.titlesize': 8,
    'xtick.labelsize': 6,
    'ytick.labelsize': 6,
    'xtick.major.width': 0.5,
    'ytick.major.width': 0.5,
    'legend.fontsize': 6,
    'figure.dpi': 300,
    'savefig.dpi': 300,
    'savefig.format': 'svg',
    'savefig.bbox': 'tight',
    'savefig.pad_inches': 0.05,
}

SEMANTIC_COLORS = {
    'tumor': '#D62728',
    'normal': '#2CA02C',
    'significant': '#1F77B4',
    'non_significant': '#CCCCCC',
    'high_confidence': '#2CA02C',
    'medium_confidence': '#FF7F0E',
    'low_confidence': '#D62728',
    'conflict': '#9467BD',
    'cd8_t': '#E377C2',
    'cd4_t': '#17BECF',
    'b_cell': '#BCBD22',
    'macrophage': '#8C564B',
    'neutrophil': '#D62728',
    'dendritic': '#9467BD',
    'approved': '#2CA02C',
    'phase3': '#1F77B4',
    'phase2': '#FF7F0E',
    'phase1': '#D62728',
    'preclinical': '#CCCCCC',
}


def apply_nature_style(ax=None, tier='citable'):
    """应用 Nature-style 样式。tier='paper' 使用 Nature 标准，其他使用默认样式。"""
    import matplotlib.pyplot as plt
    if tier == 'paper':
        plt.rcParams.update(NATURE_STYLE)
    if ax is not None:
        ax.spines['top'].set_visible(False)
        ax.spines['right'].set_visible(False)
        if tier == 'paper':
            ax.spines['left'].set_linewidth(0.5)
            ax.spines['bottom'].set_linewidth(0.5)
            ax.tick_params(width=0.5, length=3)


# Style constants
FIGURE_DPI = 150
FIGURE_FORMAT = "png"
COLORS = {
    "primary": "#2563EB",
    "secondary": "#7C3AED",
    "accent": "#059669",
    "danger": "#DC2626",
    "warning": "#D97706",
    "gray": "#6B7280",
    "light_gray": "#F3F4F6",
}
TISSUE_PALETTE = [
    "#2563EB", "#7C3AED", "#059669", "#DC2626", "#D97706",
    "#0891B2", "#4F46E5", "#9333EA", "#15803D", "#B91C1C",
    "#0369A1", "#6D28D9", "#047857", "#BE123C", "#A16207",
]


def setup_style():
    plt.rcParams.update({
        "font.size": 11,
        "axes.titlesize": 13,
        "axes.labelsize": 11,
        "xtick.labelsize": 9,
        "ytick.labelsize": 10,
        "legend.fontsize": 9,
        "figure.facecolor": "white",
        "axes.facecolor": "white",
        "axes.grid": True,
        "grid.alpha": 0.3,
        "axes.spines.top": False,
        "axes.spines.right": False,
    })


def plot_tissue_expression(
    expression_data: Dict[str, float],
    gene: str,
    output_path: Path,
    highlight_tissues: Optional[List[str]] = None,
    title: Optional[str] = None,
    tier: str = "citable",
    sample_counts: Optional[Dict[str, int]] = None,
    data_source_label: Optional[str] = None,
) -> Path:
    """Bar plot of gene expression across tissues.

    Three-level information hierarchy:
      - Level 1 (main):        Bar heights — high contrast colors
      - Level 2 (supporting):  Tissue labels — standard weight
      - Level 3 (reference):   Sample counts — light gray, smaller font

    Args:
        expression_data: {tissue_name: tpm_value}
        gene: Gene symbol for the title.
        output_path: Where to save the figure.
        highlight_tissues: Tissues to highlight with accent color.
        title: Optional custom title.
        tier: 'paper' for Nature/Cell journal standards, 'citable' for default.
        sample_counts: {tissue_name: n_samples} for Level 3 annotation.
        data_source_label: Footer annotation string (e.g. "Data: GTEx Portal v2 | n=17,382 samples").
    """
    setup_style()
    tissues = list(expression_data.keys())
    values = list(expression_data.values())

    sorted_pairs = sorted(zip(tissues, values), key=lambda x: x[1], reverse=True)
    tissues = [p[0] for p in sorted_pairs]
    values = [p[1] for p in sorted_pairs]

    fig, ax = plt.subplots(figsize=(14, max(6, len(tissues) * 0.35)))

    # Apply Nature style when tier='paper'
    apply_nature_style(ax, tier=tier)

    # Level 1 — high contrast bar colors
    colors = []
    for t in tissues:
        if highlight_tissues and t in highlight_tissues:
            colors.append(SEMANTIC_COLORS.get("tumor", COLORS["accent"]))
        else:
            colors.append(COLORS["primary"])

    bars = ax.barh(range(len(tissues)), values, color=colors, edgecolor="white", linewidth=0.5)

    ax.set_yticks(range(len(tissues)))
    ax.set_yticklabels(tissues)
    ax.invert_yaxis()
    ax.set_xlabel("Expression (TPM)")
    ax.set_title(title or f"{gene} Expression Across Tissues (GTEx)", fontweight="bold", pad=15)

    # Level 1 — value labels (high contrast)
    label_fontsize = 7 if tier == "paper" else 8
    for i, (bar, val) in enumerate(zip(bars, values)):
        if val > 0:
            ax.text(val + max(values) * 0.01, i, f"{val:.1f}", va="center", fontsize=label_fontsize)

    # Level 3 — sample counts in light gray (reference layer)
    if sample_counts:
        max_val = max(values) if values else 1
        for i, tissue in enumerate(tissues):
            n = sample_counts.get(tissue)
            if n is not None:
                ax.text(
                    max_val * 0.01, i, f"n={n:,}",
                    va="center", ha="left",
                    fontsize=5 if tier == "paper" else 6,
                    color="#AAAAAA", alpha=0.7,
                )

    ax.xaxis.set_major_formatter(ticker.FuncFormatter(lambda x, _: f"{x:.0f}"))

    # Data source annotation at bottom (provenance)
    if data_source_label:
        ax.annotate(
            data_source_label,
            xy=(0.5, -0.08), xycoords="axes fraction",
            ha="center", va="top",
            fontsize=5 if tier == "paper" else 6,
            color="#888888", fontstyle="italic",
        )

    plt.tight_layout()

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    # SVG-first for paper tier
    save_fmt = "svg" if tier == "paper" else None
    save_dpi = 300 if tier == "paper" else FIGURE_DPI
    if save_fmt:
        # Force SVG extension if not already
        if output_path.suffix.lower() != ".svg":
            output_path = output_path.with_suffix(".svg")
    fig.savefig(output_path, dpi=save_dpi, bbox_inches="tight", facecolor="white",
                format=save_fmt if save_fmt else output_path.suffix.lstrip("."))
    plt.close(fig)
    return output_path


def plot_survival_curve(
    times_high: List[float],
    times_low: List[float],
    events_high: List[int],
    events_low: List[int],
    gene: str,
    output_path: Path,
    cancer_type: str = "",
    hr: Optional[float] = None,
    p_value: Optional[float] = None,
) -> Path:
    """Kaplan-Meier survival plot comparing high vs low expression groups."""
    setup_style()
    from lifelines import KaplanMeierFitter
    from lifelines.statistics import logrank_test

    fig, ax = plt.subplots(figsize=(8, 6))

    kmf_high = KaplanMeierFitter()
    kmf_high.fit(times_high, event_observed=events_high, label="High expression")
    kmf_high.plot_survival_function(ax=ax, color=COLORS["danger"], ci_show=True, ci_alpha=0.15)

    kmf_low = KaplanMeierFitter()
    kmf_low.fit(times_low, event_observed=events_low, label="Low expression")
    kmf_low.plot_survival_function(ax=ax, color=COLORS["primary"], ci_show=True, ci_alpha=0.15)

    # Log-rank test
    if hr is None or p_value is None:
        result = logrank_test(times_high, times_low, events_high, events_low)
        p_value = result.p_value

    stats_text = []
    if hr is not None:
        stats_text.append(f"HR = {hr:.2f}")
    if p_value is not None:
        if p_value < 0.001:
            stats_text.append("p < 0.001")
        else:
            stats_text.append(f"p = {p_value:.3f}")

    if stats_text:
        ax.text(0.98, 0.02, "\n".join(stats_text),
                transform=ax.transAxes, ha="right", va="bottom",
                fontsize=10, bbox=dict(boxstyle="round,pad=0.3", facecolor="lightyellow", alpha=0.8))

    ax.set_xlabel("Time (months)")
    ax.set_ylabel("Survival Probability")
    subtitle = f" - {cancer_type}" if cancer_type else ""
    ax.set_title(f"{gene} Expression vs Overall Survival{subtitle}", fontweight="bold", pad=15)
    ax.legend(loc="lower left", frameon=True, fancybox=True)

    plt.tight_layout()
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, dpi=FIGURE_DPI, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return output_path


def plot_immune_correlation(
    expression: List[float],
    immune_scores: List[float],
    immune_cell: str,
    gene: str,
    output_path: Path,
    correlation_r: Optional[float] = None,
    p_value: Optional[float] = None,
) -> Path:
    """Scatter plot of gene expression vs immune cell infiltration."""
    setup_style()
    from scipy import stats

    fig, ax = plt.subplots(figsize=(7, 6))

    ax.scatter(expression, immune_scores, alpha=0.4, s=15, color=COLORS["primary"], edgecolors="white", linewidth=0.3)

    # Regression line
    slope, intercept, r, p, se = stats.linregress(expression, immune_scores)
    x_line = np.linspace(min(expression), max(expression), 100)
    ax.plot(x_line, slope * np.array(x_line) + intercept, color=COLORS["danger"], linewidth=2, linestyle="--")

    r_val = correlation_r or r
    p_val = p_value or p

    stats_text = f"r = {r_val:.3f}"
    if p_val < 0.001:
        stats_text += "\np < 0.001"
    else:
        stats_text += f"\np = {p_val:.3f}"

    ax.text(0.98, 0.98, stats_text, transform=ax.transAxes, ha="right", va="top",
            fontsize=10, bbox=dict(boxstyle="round,pad=0.3", facecolor="lightyellow", alpha=0.8))

    ax.set_xlabel(f"{gene} Expression (TPM)")
    ax.set_ylabel(f"{immune_cell} Infiltration Score")
    ax.set_title(f"{gene} vs {immune_cell} Infiltration", fontweight="bold", pad=15)

    plt.tight_layout()
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, dpi=FIGURE_DPI, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return output_path


def plot_volcano(
    gene_names: List[str],
    log2fc: List[float],
    pvalues: List[float],
    output_path: Path,
    highlight_gene: Optional[str] = None,
    fc_threshold: float = 1.0,
    p_threshold: float = 0.05,
    title: str = "Volcano Plot",
) -> Path:
    """Volcano plot for differential expression results."""
    setup_style()

    fig, ax = plt.subplots(figsize=(9, 7))

    log2fc_arr = np.array(log2fc)
    neg_log10p = -np.log10(np.array(pvalues) + 1e-300)

    # Classify points
    up = (log2fc_arr >= fc_threshold) & (np.array(pvalues) <= p_threshold)
    down = (log2fc_arr <= -fc_threshold) & (np.array(pvalues) <= p_threshold)
    ns = ~up & ~down

    ax.scatter(log2fc_arr[ns], neg_log10p[ns], c=COLORS["gray"], s=8, alpha=0.3, label="NS")
    ax.scatter(log2fc_arr[up], neg_log10p[up], c=COLORS["danger"], s=12, alpha=0.5, label="Up")
    ax.scatter(log2fc_arr[down], neg_log10p[down], c=COLORS["primary"], s=12, alpha=0.5, label="Down")

    if highlight_gene and highlight_gene in gene_names:
        idx = gene_names.index(highlight_gene)
        ax.scatter(log2fc_arr[idx], neg_log10p[idx], c=COLORS["accent"], s=80, zorder=5,
                   edgecolors="black", linewidth=1, label=highlight_gene)
        ax.annotate(highlight_gene, (log2fc_arr[idx], neg_log10p[idx]),
                    textcoords="offset points", xytext=(8, 8), fontsize=9, fontweight="bold")

    ax.axhline(-np.log10(p_threshold), color=COLORS["warning"], linestyle=":", alpha=0.5)
    ax.axvline(fc_threshold, color=COLORS["warning"], linestyle=":", alpha=0.5)
    ax.axvline(-fc_threshold, color=COLORS["warning"], linestyle=":", alpha=0.5)

    ax.set_xlabel("log2(Fold Change)")
    ax.set_ylabel("-log10(p-value)")
    ax.set_title(title, fontweight="bold", pad=15)
    ax.legend(loc="upper right", frameon=True)

    plt.tight_layout()
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, dpi=FIGURE_DPI, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return output_path


def plot_correlation_heatmap(
    matrix: List[List[float]],
    row_labels: List[str],
    col_labels: List[str],
    output_path: Path,
    title: str = "Correlation Heatmap",
    cmap: str = "RdBu_r",
) -> Path:
    """Heatmap for correlation matrix."""
    setup_style()

    fig, ax = plt.subplots(figsize=(max(8, len(col_labels) * 0.8), max(6, len(row_labels) * 0.6)))

    data = np.array(matrix)
    vmax = max(abs(data.min()), abs(data.max()), 1)
    im = ax.imshow(data, cmap=cmap, vmin=-vmax, vmax=vmax, aspect="auto")

    ax.set_xticks(range(len(col_labels)))
    ax.set_xticklabels(col_labels, rotation=45, ha="right")
    ax.set_yticks(range(len(row_labels)))
    ax.set_yticklabels(row_labels)

    # Add value annotations
    for i in range(len(row_labels)):
        for j in range(len(col_labels)):
            val = data[i, j]
            color = "white" if abs(val) > vmax * 0.6 else "black"
            ax.text(j, i, f"{val:.2f}", ha="center", va="center", fontsize=8, color=color)

    fig.colorbar(im, ax=ax, shrink=0.8, label="Correlation")
    ax.set_title(title, fontweight="bold", pad=15)

    plt.tight_layout()
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, dpi=FIGURE_DPI, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return output_path


def plot_expression_heatmap(
    data: Dict[str, Dict[str, float]],
    gene: str,
    output_path: Path,
    title: Optional[str] = None,
    cmap: str = "YlOrRd",
) -> Path:
    """Multi-cancer expression heatmap.

    Args:
        data: {cancer_type: {metric: value}} e.g., {"LUAD": {"tpm": 85, "log2fc": 2.1}}
        gene: Gene symbol
        output_path: Where to save
        title: Optional custom title
        cmap: Colormap name
    """
    setup_style()

    cancers = list(data.keys())
    metrics = set()
    for v in data.values():
        metrics.update(v.keys())
    metrics = sorted(metrics)

    matrix = []
    for cancer in cancers:
        row = [data[cancer].get(m, 0) for m in metrics]
        matrix.append(row)

    arr = np.array(matrix)
    fig, ax = plt.subplots(figsize=(max(8, len(metrics) * 1.2), max(5, len(cancers) * 0.5)))

    vmax = max(abs(arr.min()), abs(arr.max()), 1)
    im = ax.imshow(arr, cmap=cmap, aspect="auto")

    ax.set_xticks(range(len(metrics)))
    ax.set_xticklabels(metrics, rotation=45, ha="right", fontsize=9)
    ax.set_yticks(range(len(cancers)))
    ax.set_yticklabels(cancers, fontsize=9)

    for i in range(len(cancers)):
        for j in range(len(metrics)):
            val = arr[i, j]
            ax.text(j, i, f"{val:.1f}", ha="center", va="center", fontsize=8)

    fig.colorbar(im, ax=ax, shrink=0.8)
    ax.set_title(title or f"{gene} Expression Across Cancer Types", fontweight="bold", pad=15)

    plt.tight_layout()
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, dpi=FIGURE_DPI, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return output_path


def plot_target_radar(
    scores: Dict[str, float],
    gene: str,
    output_path: Path,
    title: Optional[str] = None,
) -> Path:
    """Target multi-dimensional scoring radar chart.

    Args:
        scores: {dimension: score} e.g., {"expression": 0.8, "druggability": 0.6, ...}
                Score range: 0-1 for each dimension.
        gene: Gene symbol
        output_path: Where to save
    """
    setup_style()

    categories = list(scores.keys())
    values = list(scores.values())
    n = len(categories)

    if n < 3:
        raise ValueError("Radar chart needs at least 3 dimensions")

    angles = np.linspace(0, 2 * np.pi, n, endpoint=False).tolist()
    values_plot = values + [values[0]]  # Close the polygon
    angles += angles[:1]

    fig, ax = plt.subplots(figsize=(7, 7), subplot_kw=dict(polar=True))

    ax.fill(angles, values_plot, color=COLORS["primary"], alpha=0.2)
    ax.plot(angles, values_plot, color=COLORS["primary"], linewidth=2, marker="o", markersize=6)

    ax.set_xticks(angles[:-1])
    ax.set_xticklabels(categories, fontsize=10)
    ax.set_ylim(0, 1)
    ax.set_yticks([0.2, 0.4, 0.6, 0.8, 1.0])
    ax.set_yticklabels(["0.2", "0.4", "0.6", "0.8", "1.0"], fontsize=8, color="gray")

    # Add value labels
    for angle, val in zip(angles[:-1], values):
        ax.annotate(f"{val:.2f}", xy=(angle, val), fontsize=9, ha="center", va="bottom",
                    fontweight="bold", color=COLORS["primary"])

    ax.set_title(title or f"{gene} Target Score Radar", fontweight="bold", pad=20, fontsize=13)

    plt.tight_layout()
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, dpi=FIGURE_DPI, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return output_path


def plot_competitive_landscape(
    companies: List[Dict],
    gene: str,
    output_path: Path,
    title: Optional[str] = None,
) -> Path:
    """Competitive landscape bubble chart.

    Args:
        companies: List of dicts with keys:
            - name: Company name
            - phase: Clinical phase (1/2/3/4 for approved)
            - trials: Number of clinical trials
            - drugs: Number of drugs
        gene: Gene symbol
    """
    setup_style()

    fig, ax = plt.subplots(figsize=(10, 7))

    for i, comp in enumerate(companies):
        x = comp.get("phase", 1)
        y = comp.get("trials", 0)
        size = max(comp.get("drugs", 1) * 100, 50)
        color_idx = i % len(TISSUE_PALETTE)

        ax.scatter(x, y, s=size, c=TISSUE_PALETTE[color_idx], alpha=0.6,
                   edgecolors="white", linewidth=1.5, zorder=3)
        ax.annotate(comp["name"], (x, y), fontsize=8, ha="center", va="bottom",
                    xytext=(0, 8), textcoords="offset points")

    ax.set_xlabel("Development Phase", fontsize=11)
    ax.set_ylabel("Number of Clinical Trials", fontsize=11)
    ax.set_xticks([1, 2, 3, 4])
    ax.set_xticklabels(["Phase I", "Phase II", "Phase III", "Approved"])
    ax.set_title(title or f"{gene} Competitive Landscape", fontweight="bold", pad=15)

    plt.tight_layout()
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, dpi=FIGURE_DPI, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return output_path


def plot_target_priority_bar(
    targets: List[str],
    scores: List[float],
    gene: str,
    output_path: Path,
    association_scores: Optional[List[float]] = None,
    title: Optional[str] = None,
) -> Path:
    """Horizontal bar chart of target priority scores."""
    setup_style()

    fig, ax = plt.subplots(figsize=(10, max(4, len(targets) * 0.45)))

    y_pos = range(len(targets))
    bars = ax.barh(y_pos, scores, color=COLORS["primary"], alpha=0.85, edgecolor="white", linewidth=0.5)

    if association_scores:
        ax.barh(y_pos, association_scores, color=COLORS["secondary"], alpha=0.5, edgecolor="white", linewidth=0.5)
        ax.legend(["Priority Score", "Association Score"], loc="lower right", frameon=True)

    ax.set_yticks(y_pos)
    ax.set_yticklabels(targets)
    ax.invert_yaxis()
    ax.set_xlabel("Score")
    ax.set_title(title or f"{gene} Target Priority Ranking", fontweight="bold", pad=15)

    for i, (bar, val) in enumerate(zip(bars, scores)):
        ax.text(val + max(scores) * 0.01, i, f"{val:.3f}", va="center", fontsize=8)

    plt.tight_layout()
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, dpi=FIGURE_DPI, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return output_path


def plot_druggability_pie(
    classes: List[str],
    gene: str,
    output_path: Path,
    title: Optional[str] = None,
) -> Path:
    """Pie chart of druggability classification distribution."""
    setup_style()
    from collections import Counter

    counts = Counter(classes)
    labels = list(counts.keys())
    values = list(counts.values())

    color_map = {
        "Tclin": COLORS["accent"],
        "Tchem": COLORS["primary"],
        "Tbio": COLORS["secondary"],
        "Tdark": COLORS["gray"],
    }
    colors = [color_map.get(l, COLORS["warning"]) for l in labels]

    fig, ax = plt.subplots(figsize=(7, 7))
    wedges, texts, autotexts = ax.pie(
        values, labels=labels, colors=colors, autopct="%1.0f%%",
        startangle=90, pctdistance=0.75, textprops={"fontsize": 11},
    )
    for t in autotexts:
        t.set_fontweight("bold")
        t.set_color("white")

    centre = plt.Circle((0, 0), 0.5, fc="white")
    ax.add_artist(centre)
    ax.set_title(title or f"{gene} Druggability Classification", fontweight="bold", pad=20, fontsize=13)

    plt.tight_layout()
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, dpi=FIGURE_DPI, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return output_path


def plot_key_players_bar(
    players: Dict[str, int],
    gene: str,
    output_path: Path,
    title: Optional[str] = None,
) -> Path:
    """Horizontal bar chart of key players by trial count."""
    setup_style()

    names = list(players.keys())[:12]
    counts = list(players.values())[:12]

    fig, ax = plt.subplots(figsize=(10, max(4, len(names) * 0.45)))

    ax.barh(range(len(names)), counts, color=TISSUE_PALETTE[:len(names)], edgecolor="white", linewidth=0.5)
    ax.set_yticks(range(len(names)))
    ax.set_yticklabels(names)
    ax.invert_yaxis()
    ax.set_xlabel("Number of Clinical Trials")
    ax.set_title(title or f"{gene} Key Players by Trial Count", fontweight="bold", pad=15)

    for i, val in enumerate(counts):
        ax.text(val + max(counts) * 0.01, i, str(val), va="center", fontsize=9)

    plt.tight_layout()
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, dpi=FIGURE_DPI, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return output_path


def plot_patent_trend(
    year_distribution: Dict[str, int],
    gene: str,
    output_path: Path,
    title: Optional[str] = None,
) -> Path:
    """Line chart of patent filing trends over years."""
    setup_style()

    years = sorted(year_distribution.keys())
    counts = [year_distribution[y] for y in years]

    fig, ax = plt.subplots(figsize=(10, 5))

    ax.fill_between(range(len(years)), counts, alpha=0.15, color=COLORS["primary"])
    ax.plot(range(len(years)), counts, color=COLORS["primary"], linewidth=2, marker="o", markersize=5)

    ax.set_xticks(range(len(years)))
    ax.set_xticklabels(years, rotation=45, ha="right", fontsize=9)
    ax.set_ylabel("Number of Patents")
    ax.set_title(title or f"{gene} Patent Filing Trend", fontweight="bold", pad=15)

    plt.tight_layout()
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, dpi=FIGURE_DPI, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return output_path


def plot_milestone_timeline(
    milestones: List[Dict],
    gene: str,
    output_path: Path,
    title: Optional[str] = None,
) -> Path:
    """Milestone Gantt-style timeline chart.

    Args:
        milestones: List of dicts with keys:
            - name: Milestone name
            - start_month: Start month from project start
            - end_month: End month
            - status: "planned" | "in_progress" | "completed"
        gene: Gene symbol
    """
    setup_style()

    fig, ax = plt.subplots(figsize=(12, max(4, len(milestones) * 0.6)))

    status_colors = {
        "completed": COLORS["accent"],
        "in_progress": COLORS["primary"],
        "planned": COLORS["gray"],
    }

    for i, ms in enumerate(milestones):
        start = ms.get("start_month", 0)
        end = ms.get("end_month", start + 6)
        status = ms.get("status", "planned")
        color = status_colors.get(status, COLORS["gray"])

        ax.barh(i, end - start, left=start, height=0.6, color=color, alpha=0.7,
                edgecolor="white", linewidth=1)
        ax.text(start + (end - start) / 2, i, ms["name"], ha="center", va="center",
                fontsize=8, fontweight="bold", color="white" if status != "planned" else "black")

    ax.set_yticks(range(len(milestones)))
    ax.set_yticklabels([ms["name"] for ms in milestones], fontsize=9)
    ax.invert_yaxis()
    ax.set_xlabel("Months from Project Start", fontsize=11)
    ax.set_title(title or f"{gene} Development Milestones", fontweight="bold", pad=15)

    # Legend
    from matplotlib.patches import Patch
    legend_elements = [
        Patch(facecolor=COLORS["accent"], label="Completed"),
        Patch(facecolor=COLORS["primary"], label="In Progress"),
        Patch(facecolor=COLORS["gray"], label="Planned"),
    ]
    ax.legend(handles=legend_elements, loc="lower right", frameon=True)

    plt.tight_layout()
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, dpi=FIGURE_DPI, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return output_path
