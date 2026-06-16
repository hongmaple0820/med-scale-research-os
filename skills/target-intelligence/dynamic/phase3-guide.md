---
name: phase3-research
description: Phase 3 深度研究详细执行指令
---

# Phase 3: Deep Research — 执行指令

## 概述
深度研究特定靶点的临床管线、竞争格局、专利、文献。

## 输入
- gene: 基因符号（如 EGFR）
- disease: 疾病名称（可选）

## 执行步骤

### Step 1: 竞争情报
**脚本**: `phase3-research/scripts/competitive_intelligence.py`
**验证**: 临床试验数据来自 ClinicalTrials.gov v2 API，药物机制来自 ChEMBL

### Step 2: 专利分析
**脚本**: `phase3-research/scripts/patent_landscape.py`
**验证**: 专利数据有来源标注。Exit code 2 = 需要 Agent 用 Playwright 补充

### Step 3: 文献检索
**脚本**: inline in `phase3-research/scripts/run_phase3.py`
**验证**: 文献引用有 PMID 验证

### Step 4: 证据分级
**脚本**: `shared/tooluniverse_integration.py`
**验证**: 9 个研究路径都有 T1-T4 分级

## QA Checklist
对照 `static/qa-checklist.md` 的 Phase 3 专项检查清单。
