---
name: phase1-expression
description: Phase 1 表达谱分析详细执行指令
---

# Phase 1: Expression Panorama — 执行指令

## 概述
分析单个基因在特定癌症类型中的表达谱、预后、免疫相关性。

## 输入
- gene_symbol: 基因符号（如 KRAS, EGFR, CD274）
- disease: 疾病名称（如 Pancreatic Cancer, Lung Adenocarcinoma）
- tcga_study_id: 可选，TCGA 研究 ID（如 paad_tcga）

## 执行步骤

### Step 1: GTEx 组织表达
**脚本**: `phase1-expression/scripts/gtex_expression.py`
**命令**: `python phase1-expression/scripts/gtex_expression.py --gene {GENE} --output-dir ./output/{GENE}`
**输出**: `gtex_{gene}_expression.json`
**验证**:
- tau_index 在 0-1 范围内
- 至少有 10 个组织的数据
- provenance.source = "GTEx Portal v2"

### Step 2: 蛋白质信息（UniProt + STRING）
**脚本**: `phase1-expression/scripts/hpa_validation.py`
**命令**: `python phase1-expression/scripts/hpa_validation.py --gene {GENE} --output-dir ./output/{GENE}`
**输出**: `hpa_{gene}_validation.json`
**验证**:
- function 字段非空
- ppi_network 至少有 5 个 interactors
- provenance 包含 UniProt 和 STRING

### Step 3: TCGA 差异表达
**脚本**: `phase1-expression/scripts/tcga_analysis.py`
**命令**: `python phase1-expression/scripts/tcga_analysis.py --gene {GENE} --cancer-type {CANCER} --output-dir ./output/{GENE}`
**输出**: `tcga_{gene}_{cancer}_analysis.json`
**验证**:
- log2fc 有值
- p_value 和 q_value 都有值
- tumor_n 和 normal_n > 0
- 如果 tumor_n < 20 或 normal_n < 5，标注低样本量警告

### Step 4: 生存分析
**脚本**: `phase1-expression/scripts/survival_analysis.py`
**命令**: `python phase1-expression/scripts/survival_analysis.py --gene {GENE} --cancer-type {CANCER} --output-dir ./output/{GENE}`
**输出**: `survival_{gene}_{cancer}_analysis.json`
**验证**:
- hr 有值且 > 0
- hr_ci_lower < hr < hr_ci_upper
- p_value 有值

### Step 5: 免疫相关性
**脚本**: `phase1-expression/scripts/immune_correlation.py`
**命令**: `python phase1-expression/scripts/immune_correlation.py --gene {GENE} --cancer-type {CANCER} --output-dir ./output/{GENE}`
**输出**: `immune_{gene}_{cancer}_correlation.json`
**验证**:
- cell_types 数组非空
- 每个 cell_type 有 correlation 和 q_value

### Step 6: TIMER 免疫浸润（V2 新增）
**脚本**: `phase1-expression/scripts/timer_immune.py`
**命令**: `python phase1-expression/scripts/timer_immune.py --gene {GENE} --cancer-type {CANCER} --output-dir ./output/{GENE}`
**输出**: `timer_{gene}_{cancer}_immune.json`
**验证**:
- 6 种免疫细胞类型都有浸润分数
- provenance.source = "UCSC Xena / TIMER 2.0"

## QA Checklist
执行完成后，对照 `static/qa-checklist.md` 的 Phase 1 专项检查清单逐项核对。

## 输出格式
参考 `static/schema-definitions.md` 中的 Phase 1 输出 Schema。
