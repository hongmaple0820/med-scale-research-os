---
name: target-expression-panorama
description: >
  分析靶点基因在不同组织和条件下的表达水平。包含 GTEx 组织表达、
  HPA 蛋白验证、TCGA 肿瘤分析、生存分析、免疫微环境相关性。
triggers:
  - 表达分析
  - 表达谱
  - 表达水平
  - 组织表达
  - 生存分析
  - 预后分析
  - 免疫浸润
  - 肿瘤表达
  - expression profiling
  - survival analysis
---

# Phase 1: Target Expression Panorama

## What This Does

Answers: "Where does this target express, and does high expression correlate with poor prognosis?"

Automatically queries GTEx, HPA, TCGA APIs, runs statistical analysis, generates
visualizations and structured report. ALL data from real APIs — no hallucination.

## How to Use

When user asks about a gene's expression or prognosis:

1. **Extract parameters** from the user's request:
   - Gene symbol (e.g., EGFR, PD-L1, CD19)
   - Cancer type (e.g., LUAD, BRCA, KIRC) — optional for tissue-only queries

2. **Run the pipeline**:
```bash
bash skills/target-intelligence/shared/run_tool.sh run_phase1.py --gene {GENE} --cancer-type {CANCER} --output-dir ./output/{GENE}
```

3. **Read results** from `./output/{GENE}/phase1_{GENE}_{CANCER}_report.json`

4. **Report findings** to the user in this structure:

```
## {GENE} 靶点表达全景分析

### 组织表达谱（GTEx 数据）
- 最高表达组织: {tissue} ({tpm} TPM)
- 组织特异性: {high_specificity_tissues}

### 肿瘤表达差异（TCGA 数据）
- 在 {CANCER} 中: {upregulated/downregulated} (log2FC={value}, p={value})

### 预后价值（生存分析）
- 风险比: HR={value} (95% CI: {lower}-{upper})
- 解读: {高表达是风险因子/保护因子}

### 免疫微环境
- 与 {immune_cell} 浸润: {正相关/负相关} (r={value}, p={value})
```

## Parameter Extraction Guide

| User Says | Extract As |
|-----------|-----------|
| "EGFR 在肺癌中的表达" | gene=EGFR, cancer=LUAD |
| "PD-L1 表达谱" | gene=CD274, no cancer → GTEx only |
| "分析 KRAS 预后" | gene=KRAS, need to ask cancer type |
| "HER2 在乳腺癌中" | gene=ERBB2, cancer=BRCA |
| "TP53 across all cancers" | gene=TP53, cancer=pan-cancer (run multiple) |

## Cancer Type Abbreviations

| Full Name | TCGA Code |
|-----------|-----------|
| Lung Adenocarcinoma | LUAD |
| Lung Squamous Cell | LUSC |
| Breast Cancer | BRCA |
| Colorectal Cancer | COAD |
| Liver Cancer | LIHC |
| Gastric Cancer | STAD |
| Prostate Cancer | PRAD |
| Kidney Cancer (Clear Cell) | KIRC |
| Melanoma | SKCM |
| Glioblastoma | GBM |
| Pancreatic Cancer | PAAD |
| Ovarian Cancer | OV |

## If Only Tissue Expression Needed

If user only asks about tissue expression (no cancer), run GTEx alone:
```bash
bash skills/target-intelligence/shared/run_tool.sh gtex_expression.py --gene {GENE} --output-dir ./output/{GENE}
```

## Error Handling

- Gene not found in GTEx → Check spelling, try Ensembl ID format
- No TCGA data for cancer type → Inform user and suggest alternative cancer types
- Survival analysis n < 20 → Report results but warn about low statistical power
- API timeout → Retry once, then report failure to user
