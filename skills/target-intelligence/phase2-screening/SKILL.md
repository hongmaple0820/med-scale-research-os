---
name: target-screening
description: >
  多维靶点筛选与优先级排序。使用 Open Targets 进行关联评分，
  评估可药性，筛选最有前景的治疗靶点。
triggers:
  - 靶点筛选
  - 筛选靶点
  - 找靶点
  - 新靶点
  - 靶点排序
  - target screening
  - target prioritization
  - find targets
  - druggability
---

# Phase 2: Target Screening & Prioritization

## What This Does

Answers: "Given a disease, which targets are most promising for drug development?"

Queries Open Targets GraphQL API for target-disease associations, checks
druggability via tractability data, generates ranked priority list.

## How to Use

When user asks to find targets for a disease:

1. **Extract disease name** from the user's request

2. **Run the pipeline**:
```bash
bash skills/target-intelligence/shared/run_tool.sh run_phase2.py --disease "{DISEASE}" --output-dir ./output/{disease_slug}
```

3. **Read results** from `./output/{disease_slug}/phase2_{disease_slug}_report.json`

4. **Report findings** to the user:

```
## {DISEASE} 靶点筛选结果

共筛选出 {N} 个候选靶点，按 Open Targets 关联评分排序：

| 排名 | 靶点 | 关联评分 | 可药性 | 说明 |
|------|------|---------|--------|------|
| 1 | {GENE} | {score} | Tclin | {description} |
| 2 | ... | ... | ... | ... |

### 推荐靶点
- **{GENE1}**: 评分最高 ({score})，已有上市药物，竞争激烈
- **{GENE2}**: 评分较高 ({score})，可药性好，差异化机会
- **{GENE3}**: 新兴靶点 ({score})，竞争较少，风险较高
```

## Parameter Extraction Guide

| User Says | Disease Name |
|-----------|-------------|
| "肺癌靶点" | "lung cancer" |
| "非小细胞肺癌" | "non-small cell lung cancer" |
| "乳腺癌新靶点" | "breast cancer" |
| "肝细胞癌" | "hepatocellular carcinoma" |
| "胰腺癌" | "pancreatic cancer" |
| "三阴性乳腺癌" | "triple-negative breast cancer" |

## Druggability Classification

| Class | Meaning | Implication |
|-------|---------|-------------|
| Tclin | Approved drugs exist | High confidence, high competition |
| Tchem | Small molecule tractable | Good drug discovery potential |
| Tbio | Antibody tractable | Biologic approach viable |
| Tdark | Limited data | High risk, may need more research |

## Follow-up Suggestions

After presenting results, suggest:
- "要不要对某个靶点做详细的表达和预后分析？" → Phase 1
- "要不要看某个靶点的竞争格局和专利？" → Phase 3
