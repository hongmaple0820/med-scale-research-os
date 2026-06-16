# Target Intelligence V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 分层升级靶点情报系统，解决幻觉、数据权威性、产出标准三个核心问题

**Architecture:** 第 1 层重写 SKILL.md 为路由器模式 + 反幻觉指令治理；第 2 层新增 TIMER 2.0 数据源 + 交叉验证升级 + 缓存层 + SVG 图表；第 3 层异步队列后续迭代

**Tech Stack:** Python 3.10+, SQLite (缓存), matplotlib (SVG), requests (API), lifelines (生存分析)

---

## File Structure

### 第 1 层新建文件
```
skills/target-intelligence/
├── manifest.yaml                    # NEW — 声明式路由配置
├── static/                          # NEW — 指令片段（每次必加载）
│   ├── anti-hallucination.md        # NEW — 反幻觉硬规则
│   ├── source-grounding.md          # NEW — 数据溯源规则
│   ├── schema-definitions.md        # NEW — 每阶段 JSON Schema
│   ├── quality-tiers.md             # NEW — A/B/C 三级质量标准
│   ├── terminology-ledger.md        # NEW — 中英术语对照表
│   └── qa-checklist.md              # NEW — 每阶段 QA 检查清单
├── dynamic/                         # NEW — 按阶段加载的详细指令
│   ├── phase1-guide.md              # NEW
│   ├── phase2-guide.md              # NEW
│   ├── phase3-guide.md              # NEW
│   └── phase4-guide.md              # NEW
```

### 第 2 层新建/修改文件
```
skills/target-intelligence/
├── shared/
│   ├── cache.py                     # NEW — SQLite 缓存层
│   ├── cross_validator.py           # MODIFY — 升级为 V2（强制 2 源一致）
│   └── visualizer.py                # MODIFY — Nature-style SVG 升级
├── phase1-expression/scripts/
│   ├── timer_immune.py              # NEW — TIMER 2.0 免疫浸润
│   └── run_phase1.py                # MODIFY — 集成 TIMER 步骤
├── phase2-screening/scripts/
│   └── target_prioritization.py     # MODIFY — 扩展遗传证据查询
├── SKILL.md                         # MODIFY — 重写为路由器模式
└── requirements.txt                 # MODIFY — 新增 python-pptx, pydeseq2
```

---

## Task 1: 创建目录结构

**Files:**
- Create: `skills/target-intelligence/static/` (directory)
- Create: `skills/target-intelligence/dynamic/` (directory)

- [ ] **Step 1: 创建目录**

```bash
cd E:/yixue-scale-engine
mkdir -p skills/target-intelligence/static
mkdir -p skills/target-intelligence/dynamic
```

- [ ] **Step 2: 验证目录存在**

```bash
ls -la skills/target-intelligence/static skills/target-intelligence/dynamic
```

Expected: 两个空目录

---

## Task 2: 编写 anti-hallucination.md

**Files:**
- Create: `skills/target-intelligence/static/anti-hallucination.md`

- [ ] **Step 1: 编写反幻觉硬规则文件**

```markdown
---
name: anti-hallucination
description: 反幻觉硬规则 — 每次对话必须加载，不可跳过
priority: 0  # 最高优先级
---

# 反幻觉规则（MANDATORY — 每次对话必须加载）

## 绝对禁止（违反任何一条即为失败）

1. **不得编造数据点** — 所有数值（TPM、p 值、HR、CI、OR、log2FC、FDR）必须来自 API 返回或从 API 数据计算得出
2. **不得编造文献引用** — PMID、DOI、标题、作者、期刊必须经过 PubMed API 验证
3. **不得编造 API 返回** — 不得用"根据数据库显示..."替代实际 API 调用
4. **不得用模糊表述替代数据** — 禁止："通常"、"一般"、"研究表明"、"有文献报道"、"大量证据表明"
5. **不得在 API 失败时用模型知识填充** — API 返回空/超时/错误时，必须标记为不可用，不得用训练数据补充

## 缺失数据处理（用占位符，不用编造）

| 场景 | 标记格式 | 示例 |
|------|----------|------|
| API 返回空 | `[DATA_NOT_AVAILABLE: {source}]: {reason}` | `[DATA_NOT_AVAILABLE: GTEx]: gene not found` |
| API 超时 | `[API_TIMEOUT: {source}]: 建议重试` | `[API_TIMEOUT: cBioPortal]: 建议重试` |
| 无对应数据源 | `[NO_SOURCE]: 建议人工补充` | `[NO_SOURCE]: 甲基化数据需人工补充` |
| 数据源冲突 | `[CONFLICT: {A} vs {B}]: 需人工审核` | `[CONFLICT: GTEx vs TIMER]: 需人工审核` |

## 来源标注（每个数据点必须附带）

每个数值型数据点必须有以下溯源字段：

```
source: {数据库名称}
api_url: {完整 API 端点}
query_params: {查询参数}
timestamp: {ISO8601 时间戳}
confidence: HIGH | MEDIUM | LOW | SPECULATIVE
```

## 置信度分级

| 级别 | 条件 | 标注 |
|------|------|------|
| HIGH | 2+ 权威数据源结果一致（方向相同，量级可比） | 可直接用于结论 |
| MEDIUM | 1 个权威数据源有直接返回 | 可用于支撑，注明单一来源 |
| LOW | 间接证据或推断链 | 仅作参考，需标注推断依据 |
| SPECULATIVE | 模型推断，无直接数据支撑 | 必须明确标注，禁止混入正式结论 |

## 过度声明检测（Overclaim Detection）

| 禁止用词 | 替换为 |
|----------|--------|
| "首次发现" | "在本次分析中观察到" |
| "证实" | "数据支持 / 提示" |
| "必然" | "倾向于" |
| "因果关系" | "相关性"（除非有孟德尔随机化证据） |
| 无 CI 的点估计 | 必须附带 95% CI 或标注 `[NO_CI]` |

## 执行检查（每次生成结论前自问）

1. 这个数据点有原始 API 返回吗？→ 没有就不写
2. 这个统计值是从原始数据计算的吗？→ 不是就标注来源
3. 这个文献引用我验证过 PMID 吗？→ 没有就不引用
4. 这个结论有 2+ 源支持吗？→ 没有就标注置信度
```

- [ ] **Step 2: 验证文件内容**

```bash
head -5 skills/target-intelligence/static/anti-hallucination.md
```

Expected: frontmatter 以 `---` 开头

---

## Task 3: 编写 source-grounding.md

**Files:**
- Create: `skills/target-intelligence/static/source-grounding.md`

- [ ] **Step 1: 编写数据溯源规则**

```markdown
---
name: source-grounding
description: 数据溯源规则 — 每个结论必须有可点击的原始数据链接
---

# 数据溯源规则

## 溯源链（每个结论必须有完整链条）

```
结论 → 分析结果 → 原始数据 → API 返回 → 数据库
```

示例：
```
结论: "KRAS 在胰腺癌中高表达"
→ 分析结果: log2FC=3.2, p=1.2e-15 (Mann-Whitney U)
→ 原始数据: cBioPortal API 返回 tumor_mean=8.5, normal_mean=1.2
→ API 端点: https://www.cbioportal.org/api/molecular-profiles/paad_tcga_mrna/values?entrezGeneId=3845
→ 数据库: TCGA Pancreatic Cancer (PAAD), n=178 tumor, n=4 normal
```

## 可点击链接（报告中每个数据段必须包含）

| 数据库 | 链接模板 |
|--------|----------|
| GTEx | `https://gtexportal.org/home/gene/{gene}` |
| cBioPortal | `https://www.cbioportal.org/gene/{gene}` |
| Open Targets | `https://www.targetvalidation.org/target/{ensembl_id}` |
| PubMed | `https://pubmed.ncbi.nlm.nih.gov/{pmid}` |
| ClinicalTrials.gov | `https://clinicaltrials.gov/ct2/show/{nct_id}` |
| ChEMBL | `https://www.ebi.ac.uk/chembl/target_report_card/{chembl_id}` |
| UniProt | `https://www.uniprot.org/uniprotkb/{accession}` |
| STRING | `https://string-db.org/network/{species_id}/{string_id}` |

## 报告中的溯源格式

每个数据段落末尾附带：

```
数据来源: {database} | 查询时间: {timestamp} | 置信度: {confidence}
原始链接: {clickable_url}
```

## 图表溯源

每张图表的标题或注释中必须包含：
- 数据来源（如 "Data: GTEx Portal v2"）
- 样本量（如 "n=17,382 samples"）
- 统计方法（如 "Mann-Whitney U, BH-corrected"）
```

---

## Task 4: 编写 schema-definitions.md

**Files:**
- Create: `skills/target-intelligence/static/schema-definitions.md`

- [ ] **Step 1: 编写 JSON Schema 定义**

```markdown
---
name: schema-definitions
description: 每阶段输入输出 JSON Schema — 确保 AI 输出格式一致
---

# JSON Schema 定义

## 通用 Provenance 对象

所有 phase 输出中的数值型字段必须包含 provenance：

```json
{
  "source": "string (required) — 数据库名称",
  "api_url": "string (required) — API 端点",
  "timestamp": "string (required) — ISO8601 格式",
  "confidence": "enum: HIGH | MEDIUM | LOW | SPECULATIVE (required)"
}
```

## Phase 1: Expression Panorama

### 输入
```json
{
  "gene_symbol": "string (required, pattern: ^[A-Z0-9-]+$)",
  "disease": "string (required)",
  "tcga_study_id": "string (optional, e.g. paad_tcga)"
}
```

### 输出（关键字段）
```json
{
  "gene": "string",
  "disease": "string",
  "gtex_expression": {
    "tissues": [
      {"tissue": "string", "median_tpm": "number >= 0"}
    ],
    "tau_index": "number (0-1)",
    "top_tissues": ["string"],
    "provenance": "Provenance"
  },
  "tcga_differential": {
    "cancer_type": "string",
    "tumor_n": "integer",
    "normal_n": "integer",
    "log2fc": "number",
    "p_value": "number",
    "q_value": "number",
    "direction": "enum: up | down | ns",
    "provenance": "Provenance"
  },
  "survival": {
    "hr": "number",
    "hr_ci_lower": "number",
    "hr_ci_upper": "number",
    "p_value": "number",
    "provenance": "Provenance"
  },
  "immune_correlation": {
    "cell_types": [
      {
        "cell_type": "string",
        "correlation": "number (-1 to 1)",
        "p_value": "number",
        "q_value": "number"
      }
    ],
    "provenance": "Provenance"
  },
  "tme_profile": {
    "phenotype": "enum: hot | cold | excluded | immunosuppressive",
    "immune_score": "number",
    "stromal_score": "number",
    "provenance": "Provenance"
  }
}
```

## Phase 2: Target Screening

### 输出（关键字段）
```json
{
  "disease": "string",
  "targets": [
    {
      "gene": "string",
      "association_score": "number (0-1)",
      "datatype_scores": {
        "genetic_association": "number",
        "somatic_mutation": "number",
        "known_drug": "number",
        "literature": "number",
        "rna_expression": "number"
      },
      "genetic_constraint": {
        "pLI": "number",
        "LOEUF": "number",
        "provenance": "Provenance"
      },
      "druggability": {
        "classification": "enum: Tclin | Tchem | Tbio | Tdark",
        "provenance": "Provenance"
      }
    }
  ]
}
```

## Phase 3: Deep Research

### 输出（关键字段）
```json
{
  "gene": "string",
  "clinical_trials": {
    "total": "integer",
    "by_phase": {"phase1": "int", "phase2": "int", "phase3": "int"},
    "provenance": "Provenance"
  },
  "drugs": {
    "approved": [{"name": "string", "mechanism": "string"}],
    "provenance": "Provenance"
  },
  "evidence_profile": {
    "paths": [
      {"name": "string", "grade": "enum: T1 | T2 | T3 | T4", "summary": "string"}
    ]
  }
}
```

## Phase 4: Business Planning

### 输出（关键字段）
```json
{
  "gene": "string",
  "development_timeline": {
    "modality": "string",
    "phases": [{"name": "string", "duration_months": "integer", "cost_musd": "number"}],
    "total_months": "integer"
  },
  "risk_analysis": {
    "technical": ["string"],
    "commercial": ["string"],
    "regulatory": ["string"]
  }
}
```
```

---

## Task 5: 编写 quality-tiers.md

**Files:**
- Create: `skills/target-intelligence/static/quality-tiers.md`

- [ ] **Step 1: 编写质量级别定义**

```markdown
---
name: quality-tiers
description: A/B/C 三级质量标准 — 根据用途选择产出级别
---

# 质量级别定义

## Tier A: 内部决策级
**用途**: 快速扫读，辅助判断"这个靶点值不值得深入"
**数据**: 关键指标 + 置信度标签，缺失数据用占位符
**图表**: 简洁柱状图/热图，内嵌 Markdown
**格式**: Markdown + JSON | < 5 分钟

## Tier B: 可引用级（默认）
**用途**: 可截图放进 PPT，经得起质疑
**数据**: 每个数据点有可点击原始链接 + API 返回佐证
**图表**: SVG-first, Nature-style rcParams, 语义色板
**格式**: HTML Dashboard + SVG + DOCX | < 15 分钟

## Tier C: 论文级
**用途**: 图表可直接放进论文补充材料
**数据**: 完整溯源链 + 统计方法说明 + 局限性讨论
**图表**: Nature/Cell 标准，三级信息层次
**格式**: PPTX + DOCX + SVG 包 | < 30 分钟

## 选择指南
| 用户说 | 选择 |
|--------|------|
| "快速看一下" / "初步判断" | Tier A |
| "做个报告" / "分析一下" (默认) | Tier B |
| "要发文章" / "投稿用" / "正式报告" | Tier C |
```

---

## Task 6: 编写 terminology-ledger.md

**Files:**
- Create: `skills/target-intelligence/static/terminology-ledger.md`

- [ ] **Step 1: 编写术语表**

```markdown
---
name: terminology-ledger
description: 中英术语对照表 — 锁定后全报告一致，不许中途改
---

# 术语表（Terminology Ledger）

> 规则: 同一概念全报告必须用同一术语。开始生成前锁定，中途不许改。

| 中文 | English | 缩写 | 说明 |
|------|---------|------|------|
| 靶点 | Target | - | 药物研发靶点 |
| 肿瘤微环境 | Tumor Microenvironment | TME | |
| 免疫浸润 | Immune Infiltration | - | |
| 风险比 | Hazard Ratio | HR | 生存分析 |
| 置信区间 | Confidence Interval | CI | |
| 比值比 | Odds Ratio | OR | |
| 特异性指数 | Tau Index | - | 0=泛表达, 1=组织特异 |
| 差异表达 | Differential Expression | DE | |
| 伪发现率 | False Discovery Rate | FDR | BH 校正 |
| 对数倍数变化 | Log2 Fold Change | log2FC | |
| 客观缓解率 | Objective Response Rate | ORR | |
| 无进展生存期 | Progression-Free Survival | PFS | |
| 总生存期 | Overall Survival | OS | |
| 药物靶点可及性 | Druggability | - | |
| 临床可成药性 | Clinical Tractability | - | Tclin/Tchem/Tbio/Tdark |
| 热肿瘤 | Hot Tumor | - | 高免疫浸润 |
| 冷肿瘤 | Cold Tumor | - | 低免疫浸润 |
| 基因约束 | Genetic Constraint | - | pLI/LOEUF |
| 孟德尔随机化 | Mendelian Randomization | MR | |
| 全基因组关联研究 | GWAS | - | |
| 表达数量性状位点 | eQTL | - | |
```

---

## Task 7: 编写 qa-checklist.md

**Files:**
- Create: `skills/target-intelligence/static/qa-checklist.md`

- [ ] **Step 1: 编写 QA 检查清单**

```markdown
---
name: qa-checklist
description: 每阶段完成前的检查清单 — 逐项核对，全部通过才能交付
---

# QA 检查清单

## 通用检查（所有阶段必须通过）
- [ ] 所有数值型数据点有原始 API 返回佐证
- [ ] 无编造的数据点（对照 API 返回逐一核对）
- [ ] 所有图表有数据来源标注
- [ ] 术语表一致（同一概念全报告用同一术语）
- [ ] 置信度标注完整（HIGH/MEDIUM/LOW/SPECULATIVE）
- [ ] 缺失数据用占位符，不用编造
- [ ] 所有 p 值有统计方法说明（检验类型 + 校正方法）
- [ ] 所有 HR/OR 有 95% CI

## Phase 1 专项
- [ ] tau_index 计算正确: τ = Σ(1-xi) / (n-1)
- [ ] TCGA 差异表达有 BH 校正
- [ ] 生存分析有 Cox PH + KM
- [ ] 免疫相关性有 FDR 校正
- [ ] TME 分型有明确判定依据

## Phase 2 专项
- [ ] Open Targets score 有 datatype 分解
- [ ] 可成药性分类有依据（Tclin/Tchem/Tbio/Tdark）
- [ ] 遗传约束数据（pLI/LOEUF）有来源

## Phase 3 专项
- [ ] 临床试验来自 ClinicalTrials.gov v2 API
- [ ] 药物机制来自 ChEMBL
- [ ] 文献引用有 PMID 验证
- [ ] 专利数据有来源标注

## Phase 4 专项
- [ ] 里程碑基于同类药物历史数据
- [ ] 市场数据有来源
- [ ] 风险覆盖技术/商业/监管三维度
```

---

## Task 8: 编写 manifest.yaml

**Files:**
- Create: `skills/target-intelligence/manifest.yaml`

- [ ] **Step 1: 编写路由配置**

```yaml
name: target-intelligence
version: "2.0"
description: >
  靶点情报分析系统 — 4 阶段标准化流水线。
  每个数据点有溯源链和置信度标注。

axes:
  phase:
    description: 分析阶段
    values: [expression, screening, research, planning, full]
    default: full
  quality_tier:
    description: 产出质量级别
    values: [internal, citable, paper]
    default: citable
  language:
    description: 报告语言
    values: [zh, en, bilingual]
    default: bilingual

mappings:
  phase:
    expression: dynamic/phase1-guide.md
    screening: dynamic/phase2-guide.md
    research: dynamic/phase3-guide.md
    planning: dynamic/phase4-guide.md
    full:
      - dynamic/phase1-guide.md
      - dynamic/phase2-guide.md
      - dynamic/phase3-guide.md
      - dynamic/phase4-guide.md

always_load:
  - static/anti-hallucination.md
  - static/source-grounding.md
  - static/schema-definitions.md
  - static/quality-tiers.md
  - static/terminology-ledger.md
  - static/qa-checklist.md

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
```

---

## Task 9: 重写 SKILL.md 为路由器模式

**Files:**
- Modify: `skills/target-intelligence/SKILL.md` (full rewrite)
- Backup: `skills/target-intelligence/SKILL.md.bak`

- [ ] **Step 1: 备份原文件**

```bash
cp skills/target-intelligence/SKILL.md skills/target-intelligence/SKILL.md.bak
```

- [ ] **Step 2: 重写 SKILL.md**（完整内容见设计文档第 3.1 节）

新的 SKILL.md 核心变化：
1. 顶部增加"CRITICAL: Load Instructions First"段落，要求 Agent 先读 manifest.yaml 再做事
2. Decision Tree 保持不变
3. 每个 Phase 的执行指令改为引用 dynamic/phase*-guide.md
4. 质量级别选择指南引用 quality-tiers.md
5. QA 检查引用 qa-checklist.md

- [ ] **Step 3: 验证格式**

```bash
head -20 skills/target-intelligence/SKILL.md
```

Expected: frontmatter 包含 triggers 列表

---

## Task 10: 编写 dynamic/phase1-guide.md

**Files:**
- Create: `skills/target-intelligence/dynamic/phase1-guide.md`

- [ ] **Step 1: 编写 Phase 1 执行指令**

内容包含：
- 6 个步骤的脚本路径、命令、输出文件、验证条件
- 每步的 QA 检查点
- 引用 schema-definitions.md 的 Phase 1 输出 Schema
- 引用 qa-checklist.md 的 Phase 1 专项

---

## Task 11: 编写 dynamic/phase2-guide.md

**Files:**
- Create: `skills/target-intelligence/dynamic/phase2-guide.md`

- [ ] **Step 1: 编写 Phase 2 执行指令**

内容包含：
- 3 个步骤 + 遗传证据扩展
- Open Targets GraphQL 查询模板
- 验证条件和 QA 检查点

---

## Task 12: 编写 dynamic/phase3-guide.md 和 phase4-guide.md

**Files:**
- Create: `skills/target-intelligence/dynamic/phase3-guide.md`
- Create: `skills/target-intelligence/dynamic/phase4-guide.md`

- [ ] **Step 1: 编写 Phase 3 指令**
- [ ] **Step 2: 编写 Phase 4 指令**

---

## Task 13: 实现 SQLite 缓存层

**Files:**
- Create: `skills/target-intelligence/shared/cache.py`

- [ ] **Step 1: 编写缓存模块**

完整 Python 代码，包含：
- `ResultCache` 类
- `make_key()` — MD5(gene|disease|phase|source)
- `get()` — 查询缓存，检查 TTL
- `set()` — 写入缓存，附带 SHA-256 hash
- `invalidate()` — 按条件删除
- `stats()` — 统计信息

- [ ] **Step 2: 验证**

```bash
python -c "
import sys; sys.path.insert(0, 'skills/target-intelligence/shared')
from cache import ResultCache
c = ResultCache()
c.set('KRAS', 'PAAD', 'phase1', 'gtex', {'test': True})
r = c.get('KRAS', 'PAAD', 'phase1', 'gtex')
print('PASS' if r and r['cached'] else 'FAIL')
c.close()
"
```

---

## Task 14: 升级交叉验证为 V2

**Files:**
- Modify: `skills/target-intelligence/shared/cross_validator.py`

- [ ] **Step 1: 读取现有文件**
- [ ] **Step 2: 新增 VALIDATION_MATRIX 常量和 `validate_with_matrix()` 方法**
- [ ] **Step 3: 验证**

```bash
python -c "
import sys; sys.path.insert(0, 'skills/target-intelligence/shared')
from cross_validator import CrossValidator
cv = CrossValidator()
results = [
    {'source': 'gtex', 'data': {'direction': 'up'}},
    {'source': 'cbioportal', 'data': {'direction': 'up'}},
]
r = cv.validate_with_matrix('expression', results)
print('PASS' if r['confidence'] == 'HIGH' else 'FAIL')
"
```

---

## Task 15: 实现 TIMER 2.0 数据获取

**Files:**
- Create: `skills/target-intelligence/phase1-expression/scripts/timer_immune.py`

- [ ] **Step 1: 编写脚本**（通过 UCSC Xena API 获取 TIMER 免疫浸润数据）
- [ ] **Step 2: 测试**

```bash
cd E:/yixue-scale-engine/skills/target-intelligence
python phase1-expression/scripts/timer_immune.py --gene KRAS --cancer-type PAAD --output-dir ./output/KRAS_test
```

- [ ] **Step 3: 清理**

```bash
rm -rf skills/target-intelligence/output/KRAS_test
```

---

## Task 16: 集成 TIMER 到 run_phase1.py

**Files:**
- Modify: `skills/target-intelligence/phase1-expression/scripts/run_phase1.py`

- [ ] **Step 1: 读取现有文件**
- [ ] **Step 2: 在 immune_correlation 之后添加 TIMER 步骤**
- [ ] **Step 3: 验证语法**

```bash
python -c "import ast; ast.parse(open('skills/target-intelligence/phase1-expression/scripts/run_phase1.py').read()); print('OK')"
```

---

## Task 17: 扩展 Open Targets 遗传证据查询

**Files:**
- Modify: `skills/target-intelligence/phase2-screening/scripts/target_prioritization.py`

- [ ] **Step 1: 读取现有文件**
- [ ] **Step 2: 扩展 GraphQL 查询添加 geneticConstraint 字段**
- [ ] **Step 3: 验证语法**

---

## Task 18: 升级 visualizer.py 为 Nature-style SVG

**Files:**
- Modify: `skills/target-intelligence/shared/visualizer.py`

- [ ] **Step 1: 读取现有文件头部**
- [ ] **Step 2: 添加 NATURE_RCPARAMS、SEMANTIC_COLORS、apply_nature_style()**
- [ ] **Step 3: 验证语法**

---

## Task 19: 更新 requirements.txt

**Files:**
- Modify: `skills/target-intelligence/requirements.txt`

- [ ] **Step 1: 添加 python-pptx 和 pydeseq2**

---

## Task 20: 端到端验证

- [ ] **Step 1: 安装依赖**
- [ ] **Step 2: 运行 Phase 1**
- [ ] **Step 3: 验证输出包含 provenance 字段**
- [ ] **Step 4: 清理测试输出**

---

## 执行顺序

```
Task 1 (目录)
  ↓
Task 2-7 (static 文件，并行)
  ↓
Task 8 (manifest.yaml)
  ↓
Task 9 (SKILL.md)
  ↓
Task 10-12 (dynamic 文件，并行)
  ↓
Task 13 (缓存层)
  ↓
Task 14 (交叉验证)
  ↓
Task 15-16 (TIMER)
  ↓
Task 17 (Open Targets 遗传证据)
  ↓
Task 18 (SVG 图表)
  ↓
Task 19 (requirements.txt)
  ↓
Task 20 (端到端验证)
```
