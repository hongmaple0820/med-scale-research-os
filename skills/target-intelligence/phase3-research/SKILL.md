---
name: target-deep-research
description: >
  靶点深度调研与竞争格局分析。包含靶点机制、临床管线、专利布局、
  竞争情报。为立项决策提供多维度依据。
triggers:
  - 靶点调研
  - 竞争格局
  - 竞争分析
  - 专利分析
  - 临床管线
  - 药物研发
  - 研发进展
  - competitive landscape
  - clinical pipeline
  - patent analysis
---

# Phase 3: Deep Research & Competitive Landscape

## What This Does

Answers: "What's the full picture of this target — who's developing what, what's in the clinic, what's patented?"

Queries ClinicalTrials.gov, ChEMBL, USPTO, and PubMed. Generates multi-dimensional
research report covering science, clinical, IP, and commercial aspects.

## How to Use

When user asks about a target's drug development or competition:

1. **Extract gene symbol** from the user's request

2. **Run the pipeline**:
```bash
bash skills/target-intelligence/shared/run_tool.sh run_phase3.py --gene {GENE} --output-dir ./output/{GENE}_research
```

3. **Read results** and present:

```
## {GENE} 靶点深度调研报告

### 临床管线（ClinicalTrials.gov）
- 总计 {N} 项临床试验
- Phase 分布: Phase 1 ({n}), Phase 2 ({n}), Phase 3 ({n})
- 主要企业: {company1} ({n} trials), {company2} ({n} trials)

### 已知药物（ChEMBL）
- {N} 种已知药物/机制
- 代表性药物: {drug1} ({mechanism}), {drug2} ({mechanism})

### 专利布局（USPTO）
- 相关专利 {N} 件
- 主要申请人: {applicant1}, {applicant2}
- 近年趋势: {increasing/stable/decreasing}

### 文献概况（PubMed）
- 相关文献 {N} 篇
- 近期热点: {topic1}, {topic2}
```

## Key Points to Highlight

- **竞争激烈度**: 100+ trials = 拥挤赛道, <10 trials = 蓝海机会
- **阶段分布**: 多数 Phase 3 = 即将有产品上市, 多数 Phase 1 = 早期赛道
- **差异化机会**: 如果多数公司做小分子，可以考虑抗体/CAR-T 等差异化路线
- **专利风险**: 核心专利是否已过期或即将过期

## Follow-up Suggestions

- "要不要做这个靶点的表达和预后分析？" → Phase 1
- "帮我生成商业计划" → Phase 4
