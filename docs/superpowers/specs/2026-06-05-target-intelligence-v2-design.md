# Target Intelligence System V2 — 分层升级设计

> **日期**: 2026-06-05
> **状态**: 设计已确认
> **方案**: 分层渐进式（方案 C）
> **目标用户**: 个人研究者（药物研发靶点评估）
> **驱动方式**: Claude Code 对话驱动

---

## 1. 问题陈述

当前 `target-intelligence` 系统已有完整的 4 阶段流水线（14+ 脚本、8 个数据源、Dashboard、多格式报告），但产出质量存在四个核心痛点：

| 痛点 | 现状 | 目标 |
|------|------|------|
| A. 数据不准确/有幻觉 | AI 可能编造数据点、统计值、文献引用 | 每个结论有原始 API 返回佐证，缺失数据用占位符 |
| B. 数据不权威 | 仅 8 个数据源，缺 TIMER、UALCAN 等权威源 | 关键指标 2+ 源交叉验证，不一致标红 |
| C. 产出不标准 | 报告格式不符合医学研究者预期 | 对标 Nature-style，SVG 图表 + 语义色板 + 三级信息层次 |
| D. 无法长时间研究 | 同步执行，复杂分析可能超时 | 异步任务队列，支持断点续跑（第 3 层） |

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    SKILL.md (路由器)                      │
│  manifest.yaml → 动态加载指令片段                          │
│  反幻觉规则 / source-grounding / JSON Schema 验证        │
│  术语表锁定 / QA Checklist / 置信度标注                    │
└────────────────────────┬────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   Phase 1           Phase 2           Phase 3           Phase 4
   表达谱             筛选              深度研究           商业规划
   GTEx              Open Targets      ClinicalTrials    里程碑
   cBioPortal        Pharos            ChEMBL            商业计划
   TIMER (新增)       GEO               PubMed            PPTX
   UniProt/STRING                     专利
        │                │                │                │
        └────────────────┴────────────────┴────────────────┘
                         │
               ┌─────────┴─────────┐
               ▼                   ▼
         交叉验证层             缓存层
         2源一致=HIGH           SQLite, 7天TTL
         冲突=CONFLICT          MD5 key
         单源=MEDIUM            SHA-256 hash
               │
               ▼
         ┌──────────────┐
         │   报告生成器   │
         │   JSON / MD    │
         │   HTML Dashboard│
         │   SVG 图表      │
         │   PPTX / DOCX   │
         └──────────────┘
```

---

## 3. 第 1 层：指令治理（1-2 天）

### 3.1 SKILL.md 重构 — 静态/动态分层

借鉴 nature-skills 的 manifest.yaml 路由模式。

**目录结构**：

```
skills/target-intelligence/
├── SKILL.md                    # 路由器（精简，检测输入参数，加载对应片段）
├── manifest.yaml               # 声明式路由：阶段 × 质量级别 × 语言
├── static/
│   ├── anti-hallucination.md   # 反幻觉硬规则（每次必加载）
│   ├── source-grounding.md     # 数据溯源规则
│   ├── schema-definitions.md   # 每阶段输入输出 JSON Schema
│   ├── quality-tiers.md        # A/B/C 三级质量标准
│   ├── terminology-ledger.md   # 中英术语对照表（锁定后不许改）
│   └── qa-checklist.md         # 每阶段完成前的检查清单
├── dynamic/
│   ├── phase1-guide.md         # Phase 1 详细执行指令
│   ├── phase2-guide.md         # Phase 2 详细执行指令
│   ├── phase3-guide.md         # Phase 3 详细执行指令
│   └── phase4-guide.md         # Phase 4 详细执行指令
```

**manifest.yaml 示例**：

```yaml
name: target-intelligence
version: 2.0
description: 靶点情报分析系统 — 4 阶段标准化流水线

axes:
  phase:
    values: [expression, screening, research, planning, full]
    default: full
  quality_tier:
    values: [internal, citable, paper]
    default: citable
  language:
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
```

### 3.2 反幻觉硬规则（static/anti-hallucination.md）

```markdown
# 反幻觉规则（每次对话必须加载，不可跳过）

## 绝对禁止
1. 不得编造任何数据点、统计值、p 值、HR、CI、OR
2. 不得编造文献引用（PMID、DOI、标题、作者、期刊）
3. 不得编造 API 返回结果（不得用"根据数据库..."替代实际查询）
4. 不得用模糊表述替代具体数据（"通常"、"一般"、"研究表明"、"有文献报道"）
5. 不得在 API 失败时用模型知识填充（必须标记为不可用）

## 缺失数据处理（用占位符，不用编造）
- API 返回空 → [DATA_NOT_AVAILABLE: {source}]: {reason}
- API 超时 → [API_TIMEOUT: {source}]: 建议重试
- 无对应数据源 → [NO_SOURCE]: 建议人工补充
- 数据冲突 → [CONFLICT: {source_a} vs {source_b}]: 需人工审核

## 来源标注（每个数据点必须附带以下字段）
{
  "source": "GTEx Portal v2",
  "api_endpoint": "https://gtexportal.org/api/v2/expression/medianTpmByTissue",
  "query_params": {"gencodeId": "ENSG00000133703"},
  "timestamp": "2026-06-05T10:30:00Z",
  "raw_response_hash": "sha256:abc123...",
  "confidence": "HIGH|MEDIUM|LOW|SPECULATIVE"
}

## 置信度分级定义
- HIGH: 2+ 权威数据源结果一致（方向相同，量级可比）
- MEDIUM: 1 个权威数据源有直接返回
- LOW: 间接证据或推断链（需标注推断依据）
- SPECULATIVE: 模型推断，无直接数据支撑（必须明确标注，禁止混入正式结论）

## 过度声明检测（Overclaim Detection）
禁止：
- "首次发现" → 改为 "在本次分析中观察到"
- "证实" → 改为 "数据支持/提示"
- "必然" → 改为 "倾向于"
- 无 CI 的点估计 → 必须附带 95% CI 或标注 [NO_CI]

## 执行检查
每次生成结论前，自问：
1. 这个数据点有原始 API 返回吗？→ 没有就不写
2. 这个统计值是从原始数据计算的吗？→ 不是就标注来源
3. 这个文献引用我验证过 PMID 吗？→ 没有就不引用
4. 这个结论有 2+ 源支持吗？→ 没有就标注置信度
```

### 3.3 数据溯源规则（static/source-grounding.md）

```markdown
# 数据溯源规则

## 溯源链
每个结论必须有完整的溯源链：
结论 → 分析结果 → 原始数据 → API 返回 → 数据库

## 可点击链接要求
每个数据点至少包含一个可点击链接：
- GTEx: https://gtexportal.org/home/gene/{gene}
- cBioPortal: https://www.cbioportal.org/gene/{gene}
- Open Targets: https://www.targetvalidation.org/target/{ensembl_id}
- PubMed: https://pubmed.ncbi.nlm.nih.gov/{pmid}
- ClinicalTrials: https://clinicaltrials.gov/ct2/show/{nct_id}

## 报告中的溯源格式
每个数据段落末尾附带：
> 数据来源: {database} | 查询时间: {timestamp} | 置信度: {confidence}
> 原始链接: {clickable_url}
```

### 3.4 JSON Schema（static/schema-definitions.md）

定义每阶段的输入输出契约，确保 AI 不会生成格式不符的输出。

Phase 1 输入：
- gene_symbol: string, required, pattern ^[A-Z0-9-]+$
- disease: string, required
- tcga_study_id: string, optional

Phase 1 输出（关键字段）：
- gtex_expression.tissues[].tissue: string
- gtex_expression.tissues[].median_tpm: number (>=0)
- gtex_expression.tau_index: number (0-1)
- gtex_expression.provenance: Provenance
- tcga_differential.log2fc: number
- tcga_differential.p_value: number
- tcga_differential.q_value: number
- tcga_differential.confidence: enum [HIGH, MEDIUM, LOW, SPECULATIVE]

Provenance 对象：
- source: string (required)
- api_url: string, format uri (required)
- timestamp: string, format date-time (required)
- raw_response_hash: string
- confidence: enum [HIGH, MEDIUM, LOW, SPECULATIVE] (required)

### 3.5 三级质量标准（static/quality-tiers.md）

```markdown
# 质量级别定义

## Tier A: 内部决策级
- 目标: 快速扫读，辅助判断
- 数据: 关键指标 + 置信度标签
- 图表: 简洁柱状图/热图，内嵌在 Markdown 中
- 格式: Markdown 报告 + JSON 数据
- 耗时: < 5 分钟生成

## Tier B: 可引用级
- 目标: 可截图放进 PPT，可发给同事，经得起质疑
- 数据: 每个数据点有可点击原始链接 + API 返回佐证
- 图表: SVG-first, Nature-style rcParams, 语义色板
- 格式: HTML Dashboard + SVG 图表 + DOCX 报告
- 耗时: < 15 分钟生成

## Tier C: 论文级
- 目标: 图表可直接放进论文补充材料
- 数据: 完整溯源链 + 统计方法说明 + 局限性讨论
- 图表: Nature/Cell 标准，三级信息层次，可直接投稿
- 格式: PPTX (Nature-style) + DOCX + SVG 图表包
- 耗时: < 30 分钟生成
```

### 3.6 术语表（static/terminology-ledger.md）

| 中文 | English | 缩写 | 说明 |
|------|---------|------|------|
| 靶点 | Target | - | 药物研发靶点 |
| 肿瘤微环境 | Tumor Microenvironment | TME | |
| 免疫浸润 | Immune Infiltration | - | |
| 风险比 | Hazard Ratio | HR | 生存分析 |
| 置信区间 | Confidence Interval | CI | |
| 特异性指数 | Tau Index | - | 0=泛表达, 1=组织特异 |
| 差异表达 | Differential Expression | DE | |
| 伪发现率 | False Discovery Rate | FDR | BH 校正 |
| 客观缓解率 | Objective Response Rate | ORR | |
| 无进展生存期 | Progression-Free Survival | PFS | |
| 总生存期 | Overall Survival | OS | |
| 药物靶点可及性 | Druggability | - | |
| 临床可成药性 | Clinical Tractability | - | Tclin/Tchem/Tbio/Tdark |
| 热肿瘤 | Hot Tumor | - | 高免疫浸润 |
| 冷肿瘤 | Cold Tumor | - | 低免疫浸润 |

### 3.7 QA Checklist（static/qa-checklist.md）

```markdown
# 每阶段完成前的检查清单

## 通用检查（所有阶段）
- [ ] 所有数值型数据点有原始 API 返回佐证
- [ ] 无编造的数据点（对照 API 返回逐一核对）
- [ ] 所有图表有数据来源标注
- [ ] 术语表一致（同一概念全报告用同一术语）
- [ ] 置信度标注完整（HIGH/MEDIUM/LOW/SPECULATIVE）
- [ ] 缺失数据用占位符，不用编造

## Phase 1 专项
- [ ] p 值 < 0.05 的结论有 BH 校正说明
- [ ] 生存分析 HR 有 95% CI
- [ ] 免疫相关性有 FDR 校正
- [ ] TME 分型有明确判定依据
- [ ] Tau Index 计算公式正确: tau = sum(1-xi) / (n-1)

## Phase 2 专项
- [ ] Open Targets association score 有 datatype 分解
- [ ] 药物可成药性分类有明确依据（Tclin/Tchem/Tbio/Tdark）
- [ ] 差异表达有火山图 + 统计方法说明

## Phase 3 专项
- [ ] 临床试验数据来自 ClinicalTrials.gov v2 API（不是模型记忆）
- [ ] 药物机制数据来自 ChEMBL（不是模型推断）
- [ ] 文献引用有 PMID 验证
- [ ] 专利数据有来源标注（USPTO/OpenAlex/Lens.org）

## Phase 4 专项
- [ ] 里程碑时间线基于同类药物历史数据（不是拍脑袋）
- [ ] 市场数据有来源（不是估算）
- [ ] 风险分析覆盖技术、商业、监管三个维度
```

---

## 4. 第 2 层：数据增强（3-5 天）

### 4.1 新增数据源

#### TIMER 2.0（P0 — 免疫浸润金标准）

**为什么需要**：现有免疫分析用 cBioPortal marker genes 做 Spearman 相关，这只是代理指标。TIMER 2.0 提供 6 种反卷积算法的免疫浸润估算，是该领域的事实标准。

**集成方案**：
- 方案 A: UCSC Xena API（TIMER 数据已整合，有正式 REST API）— 推荐
- 方案 B: 解析 TIMER2 官网（无公开 API，但数据结构固定）

**提供数据**：
- 6 种免疫细胞类型的浸润分数（B cell, CD4+ T, CD8+ T, Neutrophil, Macrophage, Dendritic）
- 6 种估算方法（TIMER, CIBERSORT, xCell, MCP-counter, EPIC, quanTIseq）
- 33 种 TCGA 癌症类型

**集成位置**：Phase 1 新增 step 5b（在 immune_correlation.py 之后）

#### Open Targets 遗传证据（P0 — 已连接未充分利用）

**为什么需要**：当前只用 Open Targets 查 association score 和 tractability。但 Open Targets 的遗传证据（GWAS、eQTL、共定位）是判断"靶点是否有遗传学支持"的关键数据。

**集成方案**：扩展现有 `target_prioritization.py` 的 GraphQL 查询，新增：
- geneticConstraint — 基因约束分数（pLI, LOEUF）
- knownDrugs — 已知药物（扩展）
- evidence — 遗传关联证据（GWAS catalog、PhenoDigm、GENOMIO）

#### UniProt 变异数据（P1 — 已连接未用变异字段）

**集成方案**：扩展现有 `hpa_validation.py` 的 UniProt 查询，新增：
- 已知致病突变（ClinVar 整合）
- 蛋白质结构域变异
- 功能丧失（LoF）变异

### 4.2 交叉验证强制化

升级 `shared/cross_validator.py` 为 V2：

验证矩阵：

| 类别 | 数据源 | 验证指标 | 最少源数 |
|------|--------|----------|----------|
| expression | gtex, cbioportal, timer | 方向一致（up/down） | 2 |
| survival | cbioportal | HR 方向 | 1（暂允许单源） |
| immune | timer, cbioportal_marker | 相关性方向 | 2 |
| druggability | open_targets, pharos | 可成药性分类 | 1 |

逻辑：
- 2+ 源方向一致 → HIGH
- 源间冲突 → CONFLICT（标红，提示人工审核）
- 单源 → MEDIUM
- 无数据 → NO_DATA

### 4.3 缓存层

SQLite 缓存，适合个人使用（比 Redis 轻量）：

- 表结构: cache_key (PK), gene, disease, phase, source, data (JSON), response_hash (SHA-256), created_at, expires_at
- Key 生成: MD5(gene|disease|phase|source)
- TTL: 7 天
- 过期策略: 查询时检查 expires_at > now()

### 4.4 图表升级：Nature-style SVG

升级 `shared/visualizer.py`：

**统一 rcParams**（每次绘图前强制设置）：
- font: Arial/Helvetica, 7pt
- axes.linewidth: 0.5
- figure.dpi: 300
- savefig.format: svg

**语义色板**（每种颜色有含义）：
- tumor: #D62728 (红)
- normal: #2CA02C (绿)
- significant: #1F77B4 (蓝)
- non_significant: #CCC (灰)
- high_confidence: #2CA02C (绿)
- medium_confidence: #FF7F0E (橙)
- low_confidence: #D62728 (红)
- conflict: #9467BD (紫)
- 免疫细胞: 各有专属色
- 药物阶段: approved=绿, phase3=蓝, phase2=橙, phase1=红, preclinical=灰

**三级信息层次**：
- Level 1 主结论: 大字(8pt)、粗线(1.5pt)、高对比色
- Level 2 支撑数据: 中字(7pt)、标准线(0.5pt)、标准色
- Level 3 参考信息: 小字(6pt)、细线(0.25pt)、浅色(#999)

---

## 5. 第 3 层：异步 + 长研究（后续迭代）

### 5.1 异步任务队列
- Celery + Redis
- 每个 phase 作为独立 task
- 支持断点续跑（复用现有 CheckpointManager）
- 完成后通过桌面通知推送

### 5.2 深度研究模式
- 多轮 PubMed 检索：初筛 → 引用追踪 → 引用被引 → 数据补全
- 文献全文解析（PMC OA）
- 自动提取关键数据点

### 5.3 成本控制
- 缓存层（第 2 层已实现）
- API 调用预算（每日上限）
- 相同基因+疾病 7 天内不重复查询

---

## 6. 交付计划

| 层 | 交付物 | 时间 | 依赖 |
|----|--------|------|------|
| 第 1 层 | 重构 SKILL.md + manifest.yaml + 6 个 static 文件 + 4 个 dynamic 文件 | 1-2 天 | 无 |
| 第 2 层 | TIMER 2.0 集成 + Open Targets 遗传证据 + 交叉验证升级 + 缓存层 + SVG 图表 | 3-5 天 | 第 1 层 |
| 第 3 层 | Celery + Redis 异步 + 深度研究模式 | 后续 | 第 2 层 |

### 第 1 层具体任务
1. 创建 `static/` 目录结构
2. 编写 `anti-hallucination.md`
3. 编写 `source-grounding.md`
4. 编写 `schema-definitions.md`（4 个 phase 的 JSON Schema）
5. 编写 `quality-tiers.md`
6. 编写 `terminology-ledger.md`
7. 编写 `qa-checklist.md`
8. 编写 `manifest.yaml`
9. 重写 `SKILL.md` 为路由器模式
10. 编写 4 个 `dynamic/phase*-guide.md`

### 第 2 层具体任务
1. 实现 TIMER 2.0 数据获取（`phase1-expression/scripts/timer_immune.py`）
2. 扩展 `target_prioritization.py` 的 Open Targets 遗传证据查询
3. 扩展 `hpa_validation.py` 的 UniProt 变异数据
4. 升级 `cross_validator.py` 为 V2（强制 2 源一致）
5. 实现 `shared/cache.py`（SQLite 缓存层）
6. 升级 `visualizer.py`（Nature-style SVG + 语义色板）
7. 更新 `run_phase1.py` 集成 TIMER 步骤
8. 更新 requirements.txt

---

## 7. 参考来源

| 项目 | 借鉴内容 |
|------|----------|
| nature-skills | 静态/动态分层、manifest.yaml 路由、反幻觉规则、术语表、QA checklist、SVG-first 图表 |
| OpenBioMed | 45 skills 的数据库集成模式、Expert-in-the-loop 设计 |
| OpenClaw-Medical-Skills | 869 skills 的多数据库交叉引用、GRADE 证据分级、定量评分 |

---

## 8. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| TIMER 2.0 无公开 API | 无法直接集成 | 用 UCSC Xena API 替代（TIMER 数据已整合） |
| Open Targets GraphQL schema 变更 | 遗传证据查询失败 | 用 schema introspection 做运行时检查 |
| 缓存数据过期后 API 不可用 | 降级 | 旧数据仍可作为参考，标注 [CACHED_STALE] |
| SVG 图表在 DOCX 中兼容性差 | 降级 | DOCX 用 PNG 备选，Dashboard/PPTX 用 SVG |
