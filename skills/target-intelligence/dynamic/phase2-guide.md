---
name: phase2-screening
description: Phase 2 靶点筛选详细执行指令
---

# Phase 2: Target Screening — 执行指令

## 概述
针对特定疾病，从 Open Targets 获取靶点-疾病关联排名，评估可成药性。

## 输入
- disease: 疾病名称（如 "lung adenocarcinoma"）
- top_n: 返回前 N 个靶点（默认 10）

## 执行步骤

### Step 1: Open Targets 靶点优先级
**脚本**: `phase2-screening/scripts/target_prioritization.py`
**命令**: `python phase2-screening/scripts/target_prioritization.py --disease "{DISEASE}" --output-dir ./output/{disease_slug}`
**输出**: `target_priority_{disease}.json`
**验证**:
- targets 数组非空
- 每个 target 有 association_score (0-1)
- 每个 target 有 datatype_scores 分解
- provenance.source = "Open Targets Platform"

### Step 2: 药物可成药性
**脚本**: `phase2-screening/scripts/pharos_druggability.py`
**命令**: `python phase2-screening/scripts/pharos_druggability.py --gene {GENE} --output-dir ./output/{disease_slug}`
**输出**: `druggability_{gene}.json`
**验证**:
- classification 为 Tclin/Tchem/Tbio/Tdark 之一
- provenance 包含 Pharos 或 Open Targets

### Step 3: 差异表达（需要 GEO ID）
**脚本**: `phase2-screening/scripts/differential_expression.py`
**命令**: `python phase2-screening/scripts/differential_expression.py --geo-id {GEO_ID} --output-dir ./output/{disease_slug}`
**输出**: `de_{geo_id}_results.json`
**验证**:
- 有火山图 PNG
- 统计方法说明完整

## 遗传证据扩展（V2 新增）
在 Step 1 中，扩展 GraphQL 查询获取：
- geneticConstraint（pLI, LOEUF）
- 遗传关联证据（GWAS catalog）

## QA Checklist
对照 `static/qa-checklist.md` 的 Phase 2 专项检查清单。
