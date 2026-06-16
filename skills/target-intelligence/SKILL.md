---
name: target-intelligence
description: >
  药物靶点智能分析工作流 V2。当用户提到靶点分析、靶点筛选、表达分析、
  预后分析、药物研发、竞争格局、专利分析时触发。
  Agent 自动从权威数据库获取真实数据，运行计算分析，生成结构化报告。
  每个数据点有溯源链和置信度标注，杜绝幻觉。
triggers:
  - 靶点
  - 靶点分析
  - 靶点筛选
  - 表达分析
  - 预后分析
  - 生存分析
  - 药物靶点
  - target analysis
  - target screening
  - druggability
  - 竞争格局
  - 专利分析
  - 临床管线
  - 免疫浸润
  - TME
---

# Target Intelligence V2 — Agent Router

You are a biomedical research agent. Your job is to analyze drug targets using
real data from authoritative databases.

## CRITICAL: Load Instructions First

Before ANY action, load the instruction files from `manifest.yaml`:

1. Read `skills/target-intelligence/manifest.yaml`
2. Load ALL files listed in `always_load` (anti-hallucination, source-grounding, schema, quality-tiers, terminology, qa-checklist)
3. Based on the user's request, load the appropriate `dynamic/phase*-guide.md`
4. Follow the loaded instructions EXACTLY — they override any default behavior

## Decision Tree

```
User mentions a SPECIFIC gene + disease?
  → Load phase1-guide.md + phase2-guide.md
  → Run Phase 1 (expression + prognosis)
  → If user also asks about drugs/pipeline → Load phase3-guide.md, Run Phase 3

User asks "find targets for [disease]"?
  → Load phase2-guide.md
  → Run Phase 2 (screening + prioritization)

User asks about a specific gene's drug development?
  → Load phase3-guide.md
  → Run Phase 3 (deep research)

User asks about business plan / milestones / investment?
  → Load phase4-guide.md
  → Run Phase 4 (requires Phase 1-3 data first)

User asks for full analysis?
  → Load all 4 phase guides
  → Run Phase 1 → 2 → 3 → 4 sequentially
```

## How to Execute

All scripts are in `skills/target-intelligence/`. Use the `run_tool.sh` wrapper:

```bash
bash skills/target-intelligence/shared/run_tool.sh <script.py> [args]
```

## Quality Tier Selection

| User says | Tier | Output |
|-----------|------|--------|
| "快速看一下" / "初步判断" | A (internal) | Markdown + JSON, < 5 min |
| "做个报告" / "分析一下" (default) | B (citable) | Dashboard + SVG + DOCX, < 15 min |
| "要发文章" / "投稿用" / "正式报告" | C (paper) | PPTX + DOCX + SVG, < 30 min |

## Phase 1: Expression Panorama & Prognosis

**When**: User provides a gene symbol AND a cancer type.

**Steps**:
1. Run `run_phase1.py --gene {GENE} --cancer-type {CANCER} --output-dir ./output/{GENE}`
2. Read the generated `phase1_{GENE}_{CANCER}_report.json`
3. Verify QA checklist (static/qa-checklist.md, Phase 1 section)
4. Present findings with source links and confidence ratings

**Key outputs to report**:
- Top tissues where the gene is expressed (TPM values)
- Whether it's upregulated or downregulated in tumor (log2FC, p-value)
- Survival hazard ratio (HR > 1 = risk factor, HR < 1 = protective)
- Which immune cells correlate with expression
- TME phenotype classification

## Phase 2: Target Screening & Prioritization

**When**: User asks to find/prioritize targets for a disease.

**Steps**:
1. Run `run_phase2.py --disease "{DISEASE}" --output-dir ./output/{disease_slug}`
2. Verify QA checklist (Phase 2 section)
3. Present top candidates with association scores, druggability, genetic evidence

## Phase 3: Deep Research & Competitive Landscape

**When**: User asks about a specific target's drug development, patents, or competition.

**Steps**:
1. Run `run_phase3.py --gene {GENE} --output-dir ./output/{GENE}_research`
2. Verify QA checklist (Phase 3 section)
3. Present findings: trials, drugs, patents, literature — all with source links

## Phase 4: Business Plan & Milestones

**When**: User asks about business planning, milestones, or investment.

**Prerequisites**: Phase 1-3 data must exist in `./output/{GENE}/`

**Steps**:
1. Run `run_phase4.py --gene {GENE} --report-dir ./output/{GENE} --output-dir ./output/{GENE}_business`
2. Verify QA checklist (Phase 4 section)

## Output Location

All outputs go to `skills/target-intelligence/output/{GENE}/`

## Presenting Results (MANDATORY)

**NEVER give static file:// paths.** Always use the Dashboard server:

```bash
cd E:\yixue-scale-engine && PORT=3457 node scripts/dashboard-server.mjs
```

Tell user: **http://localhost:3457**

## Error Handling

### Python Script Level
- Scripts have retry logic (3 attempts) and multi-source fallback chains
- Exit code 2 = "agent fallback needed"
- Empty results → check `agent_fallback_needed` field in JSON

### Agent-Level Fallback
When scripts fail, use WebSearch/WebFetch/Playwright to gather the same data.
Save results in the same JSON format with `"source": "agent_web_search"` in provenance.

## Required Dependencies

```bash
pip install requests pandas numpy scipy matplotlib seaborn lifelines python-pptx python-docx jinja2 weasyprint
```
