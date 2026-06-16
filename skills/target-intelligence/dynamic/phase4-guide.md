---
name: phase4-planning
description: Phase 4 商业规划详细执行指令
---

# Phase 4: Business Planning — 执行指令

## 概述
基于 Phase 1-3 数据，生成商业计划、开发里程碑、风险分析。

## 前置条件
Phase 1-3 数据必须存在于 `./output/{GENE}/`

## 执行步骤

### Step 1: 里程碑规划
**脚本**: `phase4-planning/scripts/milestone_planner.py`
**验证**: 时间线基于同类药物历史数据，不是拍脑袋

### Step 2: 商业计划
**脚本**: `phase4-planning/scripts/business_plan.py`
**验证**: 市场数据有来源，风险覆盖技术/商业/监管三维度

### Step 3: PPTX 生成
**脚本**: `shared/nature_pptx.py`
**验证**: 7 张幻灯片，Nature-style，有 QA 报告

## QA Checklist
对照 `static/qa-checklist.md` 的 Phase 4 专项检查清单。
