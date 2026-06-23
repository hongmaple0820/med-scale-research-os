# 医学研究工作流平台 — 可扩展系统架构设计

> **版本**: 1.0.0-draft
> **日期**: 2026-06-08
> **状态**: Proposed
> **作者**: Software Architect

---

## 目录

1. [执行摘要](#1-执行摘要)
2. [现状诊断](#2-现状诊断)
3. [架构总览](#3-架构总览)
4. [领域模型与限界上下文](#4-领域模型与限界上下文)
5. [六层架构详设](#5-六层架构详设)
6. [核心决策记录 (ADR)](#6-核心决策记录-adr)
7. [数据架构](#7-数据架构)
8. [合规与安全](#8-合规与安全)
9. [可扩展性策略](#9-可扩展性策略)
10. [三阶段演进路线图](#10-三阶段演进路线图)
11. [风险矩阵](#11-风险矩阵)

---

## 1. 执行摘要

### 问题

当前 SCALE Engine 的医学研究子系统 (`target-research-platform/`) 是一个独立的 Python 脚本集合，与核心 TypeScript 引擎之间缺乏结构化集成。核心工作流编排器的 LLM 调用仍是模拟的，Python 分析脚本的数据质量存在已知问题（4/5 Phase 1 分析为空壳）。这意味着系统虽已具备完整的架构骨架（6 层分层 + DAG 编排 + FSM + EventBus），但尚未形成真正可用的端到端研究管线。

### 方案

本设计提出在现有模块化单体之上，通过 **Python-TS 桥接层** 统一双语言边界，以 **4-Stage Pipeline** 为核心重构医学研究领域引擎，并规划三阶段演进路径：**管线打通 → 规模化合规 → AI 开放生态**。

### 核心权衡

| 决策 | 获得 | 放弃 |
|------|------|------|
| 模块化单体（而非微服务） | 部署简单、开发速度快、团队无需分布式运维经验 | 独立扩展能力、团队自主权、故障隔离 |
| PostgreSQL 作为研究数据仓库 | 成熟生态、丰富分析工具、事务一致性 | 超大规模 OLAP 查询需要 ClickHouse 补充 |
| Python-TS 桥接层（而非重写为单语言） | 保留 Python 科学计算生态、渐进式迁移 | 跨语言调用的复杂度、类型安全边界需要严格维护 |
| DAG 工作流编排（而非 Nextflow） | 与 SCALE 引擎原生集成、Agent 调度能力 | 生命科学领域的标准化、nf-core 社区生态 |

---

## 2. 现状诊断

### 2.1 架构现状

当前系统是一个 **模块化单体**，包含 6 个架构层、302 个 TypeScript 源文件，以及一个独立的 Python 子系统。核心引擎已交付 SCALE 2.0 三引擎架构（Shield / Orchestrator / Cortex）。

**架构分层（当前）**：
```
L6  Evolution — BehaviorTracker, LessonExtractor, SelfImproveEngine
L5  Memory    — KnowledgeBase, UbiquitousLanguageManager
L4  Orchestration — TaskEngine, WorkflowOrchestrator, AgentPool, DAGBuilder
L3  Observability — EventBus, PhaseMarkerTracker, SessionStateTracker
L2  Guardrails — Gateway, 5 detectors, Role permission, OWASP Detector
L1  Context   — ContextBuilder, AntiPatternRegistry, CavemanCompressor
    Core      — Container(DI), EventBus, Logger
    Artifact  — FSM, Store(SQLite+JSONL), Type System
```

### 2.2 关键差距

| 编号 | 差距 | 严重程度 | 影响 |
|------|------|----------|------|
| G1 | `WorkflowOrchestrator.simulateExecution()` 是空壳，LLM 调用未接入 | CRITICAL | DAG 工作流编排器无法真正执行 |
| G2 | Python 分析脚本 4/5 是空壳，TCGA 查询返回 0 结果 | CRITICAL | 医学研究管线无法产出有效数据 |
| G3 | Python-TS 之间无结构化集成桥梁 | HIGH | 两套系统割裂，难以端到端串联 |
| G4 | `src/workflows/` 与 `src/workflow/` 两套工作流系统并存 | MEDIUM | 新开发者困惑，维护成本高 |
| G5 | Dashboard 与后端数据流不完整 | MEDIUM | 用户无法看到真实研究结果 |
| G6 | 无审计追踪、无权限体系 | HIGH | 无法满足法规合规要求 |
| G7 | `nature-skills/` 与 `skills/target-intelligence/` 功能重叠 | LOW | 维护分散，可能出现行为不一致 |

---

## 3. 架构总览

### 3.1 设计原则

1. **领域优先** — 先理解靶点发现业务，再选技术。每个限界上下文对应一个清晰的业务概念。
2. **渐进增强** — 不做 Big Bang 重写，每一步都可交付、可验证。
3. **可逆决策** — 技术选型优先考虑容易更换的方案。PostgreSQL 可以换，领域模型设计很难改。
4. **证据驱动** — 延续 SCALE 的核心理念：每个决策有审计记录，每步执行有验证门禁。
5. **合规内置** — 审计追踪和权限控制不是后期补丁，而是架构基础。

### 3.2 目标架构

六层架构，自下而上依赖：

```
┌─────────────────────────────────────────────────────┐
│  L6: 用户接入层 — Dashboard / MCP / REST / CLI      │
├─────────────────────────────────────────────────────┤
│  L5: 应用服务层 — Project / Target / Analysis / ... │
├─────────────────────────────────────────────────────┤
│  L4: 领域引擎层 — BC1 表达 / BC2 筛选 / BC3 调研   │
├─────────────────────────────────────────────────────┤
│  L3: 工作流编排层 — DAG / Pipeline / Gate / Check   │
├─────────────────────────────────────────────────────┤
│  L2: 数据基础设施 — SQLite / PostgreSQL / ClickHouse │
├─────────────────────────────────────────────────────┤
│  L1: 外部集成层 — GTEx / TCGA / HPA / PubMed / ... │
└─────────────────────────────────────────────────────┘
```

**依赖方向**：L6 → L5 → L4 → L3 → L2 → L1。严格单向依赖，禁止反向调用。

---

## 4. 领域模型与限界上下文

### 4.1 事件风暴核心事件

```
TargetRequested        — 用户发起靶点研究请求
ExpressionAnalyzed     — 表达分析完成（GTEx/TCGA/HPA/生存/免疫）
SurvivalCurveGenerated — Kaplan-Meier 生存曲线生成
CandidateRanked        — 靶点候选排序完成（成药性评分）
LiteratureCollected    — 文献收集完成（PubMed/PMC）
CompetitorMapped       — 竞品格局映射完成
ReportGenerated        — 研究报告生成完成
AnalysisFailed         — 任一阶段分析失败
GateCheckPassed        — 门禁验证通过
GateCheckFailed        — 门禁验证失败
```

### 4.2 限界上下文映射

```
┌──────────────────────────────────────────────────────────┐
│                   靶点发现上下文                           │
│                   (TargetDiscovery)                      │
│  Aggregate Root: ResearchProject                         │
│  协调 3 个下游子上下文                                     │
├──────────────┬──────────────────┬────────────────────────┤
│ BC1: 表达    │ BC2: 靶点筛选    │ BC3: 深度调研           │
│ 分析引擎     │ 引擎             │ 引擎                    │
│              │                  │                         │
│ Aggregate:   │ Aggregate:       │ Aggregate:              │
│ Target       │ TargetCandidate  │ ResearchProfile         │
│ Expression   │                  │                         │
│              │ Upstream:        │ Upstream:               │
│ Upstream:    │ BC1 输出          │ BC2 输出                │
│ Target       │                  │                         │
│ Requested    │ Domain Events:   │ Domain Events:          │
│              │ CandidateRanked  │ LiteratureCollected      │
│ Domain       │ AnalysisFailed   │ CompetitorMapped        │
│ Events:      │                  │ ReportGenerated         │
│ Expression   │ Anti-Corruption: │                         │
│ Analyzed     │ 上游数据验证     │ Anti-Corruption:         │
│ Survival     │                  │ PubMed 结果清洗         │
│ CurveGen     │                  │ 竞品名称归一化           │
└──────────────┴──────────────────┴────────────────────────┘
```

### 4.3 上下文关系

| 上游 | 下游 | 关系模式 | 集成方式 |
|------|------|----------|----------|
| BC1 表达分析 | BC2 靶点筛选 | Upstream-Downstream | 防腐层 (ACL) — BC1 输出经标准化后传入 |
| BC2 靶点筛选 | BC3 深度调研 | Upstream-Downstream | 防腐层 (ACL) — 排序结果经 DTO 转换 |
| 外部 API 集成层 | 所有 BC | Shared Kernel | 数据源适配器 (Adapter) 统一接口 |
| SCALE 核心 | 靶点发现 | Conformist | 靶点发现遵循 SCALE 工作流协议 |

---

## 5. 六层架构详设

### 5.1 L1: 外部集成层 (Integration Layer)

**职责**：封装所有外部生物信息学 API 调用，提供统一的 `DataSourceAdapter` 接口。

**设计模式**：Adapter + Circuit Breaker + Rate Limiter

```typescript
interface DataSourceAdapter {
  readonly name: string;
  readonly baseUrl: string;
  query(request: DataQuery): Promise<DataResponse>;
  healthCheck(): Promise<HealthStatus>;
  // 每个 API 实现限流和熔断
}
```

**已识别的 10 个外部数据源**：

| 数据源 | 类型 | 认证 | 现有适配器 | 优先级 |
|--------|------|------|------------|--------|
| GTEx Portal | REST API | 无 | `gtex_client.py` | P0 |
| TCGA / GDC | REST API | Token | `tcga_client.py` | P0 |
| HPA Portal | Web Scraping | 无 | `hpa_client.py` (空壳) | P0 |
| TIMER2.0 | REST API | 无 | `timer_client.py` | P0 |
| PubMed (E-utilities) | REST API | API Key | `pubmed_client.py` | P1 |
| OpenTargets | GraphQL | 无 | `opentargets_client.py` | P0 |
| GEO (NCBI) | REST API | 无 | `geo_client.py` | P1 |
| ClinicalTrials.gov | REST API | 无 | `clinicaltrials_client.py` | P1 |
| UniProt | REST API | 无 | 无 | P2 |
| STRING DB | REST API | 无 | 无 | P2 |

**关键设计**：
- 每个适配器实现 **断路器模式**（连续 5 次超时 → Open → 30s 后 Half-Open）
- 统一 **速率限制**：NCBI E-utilities 3 req/s（无 API Key）、10 req/s（有 Key）
- API 响应 **标准化**：无论原始格式如何，输出统一为 `DataResponse` DTO
- **本地缓存层**：命中缓存则跳过网络调用，减少 API 压力

### 5.2 L2: 数据基础设施层 (Data Infrastructure)

**多数据库策略** — 按职责分离存储：

| 数据库 | 用途 | 选型理由 |
|--------|------|----------|
| **SQLite** | SCALE 引擎内部状态 (Artifact/FSM/EventBus) | 轻量、零部署、已有代码 |
| **PostgreSQL** | 研究数据仓库（靶点、分析结果、报告） | 成熟生态、事务一致、JSON 支持 |
| **ClickHouse** | OLAP 分析（大规模组学数据查询） | 列式存储、pb 级数据处理（对标 cBioPortal v7） |
| **Redis** | 缓存 + 任务队列 | 减少重复 API 调用、异步任务调度 |
| **S3 / OSS** | 数据湖（原始 FASTQ/BAM、大文件） | 成本优势、对象存储标准 |

**PostgreSQL 核心表设计**：

```
research_projects      — 研究项目（与 SCALE Artifact 关联）
target_genes           — 靶点基因（基因名、Uniprot ID、别名）
expression_results     — 表达分析结果（GTEx/TCGA/HPA 各维度）
survival_analyses      — 生存分析结果（KM 曲线参数、log-rank p-value）
immune_profiles        — 免疫浸润谱
screening_candidates   — 筛选候选（成药性评分、优先级）
literature_references  — 文献引用（PubMed ID、标题、摘要、相关性评分）
competitor_entries     — 竞品条目（ClinicalTrials NCT ID、Phase、适应症）
analysis_audit_log     — 分析审计日志（ALCOA+ 合规）
data_source_cache      — API 缓存（TTL、ETag、响应体）
```

### 5.3 L3: 工作流编排层 (Workflow Orchestration)

**核心职责**：管理 4-Stage Pipeline 的 DAG 编排、门禁验证、检查点恢复。

**4-Stage Pipeline DAG**：

```
Stage 1: 表达分析                    Stage 2: 靶点筛选
┌──────────────────┐                ┌──────────────────┐
│ GTEx 组织表达     │───┐            │ GEO 差异表达     │───┐
│ TCGA 肿瘤差异    │───┼──→ 汇总 ──→│ OpenTargets 成药性 │───┼──→ 排序
│ HPA 蛋白验证     │───┤            │ 综合评分         │───┘   │
│ 生存分析         │───┤            └──────────────────┘        │
│ 免疫浸润         │───┘                                        │
└──────────────────┘                                           │
                                                              ↓
                    Stage 3: 深度调研              Stage 4: 商业规划
                    ┌──────────────────┐         ┌──────────────────┐
                    │ UniProt 功能百科 │───┐     │ 里程碑规划      │──→ 报告生成
                    │ PubMed 文献综述 │───┼──→ 汇集 │ 竞品格局      │
                    │ 竞品分析         │───┘     │ 商业计划书      │
                    └──────────────────┘         └──────────────────┘
```

**编排器改进点**：

1. **替换 `simulateExecution()`**：接入真实 LLM 调用（通过 Agent 适配器）
2. **Python 子进程桥接**：每 Stage 的 Python 分析脚本通过标准化 JSON 协议通信
3. **检查点机制**：每 Stage 完成后持久化快照，支持从中断点恢复
4. **门禁集成**：每个 Stage 边界插入 Gate Check（数据完整性、统计显著性阈值）

**Python-TS 桥接协议**：

```json
{
  "protocol": "scale-analysis-v1",
  "stage": "expression",
  "input": { "gene": "TP53", "sources": ["gtex", "tcga", "hpa"] },
  "timeout_ms": 300000,
  "output_schema": "expression_analysis_result_v1"
}
```

Python 进程通过 stdout 输出符合 `output_schema` 的 JSON，SCALE 引擎解析并持久化到 PostgreSQL。

### 5.4 L4: 领域引擎层 (Domain Engine Layer)

**三个限界上下文的领域引擎**：

#### BC1: 表达分析引擎

**Aggregate Root**: `TargetExpression`
**业务不变量**：
- 所有分析必须有数据源引用（可溯源）
- p-value 阈值 < 0.05 才标记为显著
- 生存分析必须有 log-rank 检验

**领域服务**：
- `ExpressionAnalyzer` — 调度多数据源并行分析
- `SurvivalCurveCalculator` — Kaplan-Meier + log-rank
- `ImmuneCorrelator` — 免疫浸润相关性分析
- `TissueSpecificityScorer` — 组织特异性评分

#### BC2: 靶点筛选引擎

**Aggregate Root**: `TargetCandidate`
**业务不变量**：
- 排序必须综合多维度（表达量、差异显著性、成药性）
- 成药性评分来源必须记录（OpenTargets/ChEMBL/手动评估）

**领域服务**：
- `DifferentialExpressionFilter` — 差异表达过滤
- `DruggabilityScorer` — 成药性综合评分
- `CandidateRanker` — 多维排序引擎
- `PriorityRuleEngine` — 自定义筛选规则

#### BC3: 深度调研引擎

**Aggregate Root**: `ResearchProfile`
**业务不变量**：
- 文献引用必须有 PubMed ID（可验证）
- 竞品分析 Phase 必须标注（Phase I/II/III/IV）
- 报告必须包含数据溯源信息

**领域服务**：
- `LiteratureCollector` — PubMed 检索 + 相关性排序
- `CompetitiveMapper` — ClinicalTrials 竞品映射
- `FunctionEncyclopedist` — UniProt/STRING 功能汇总
- `ReportComposer` — 多源信息整合报告生成

### 5.5 L5: 应用服务层 (Application Service Layer)

**编排领域引擎，暴露给接入层的用例**：

| 应用服务 | 核心用例 | 依赖的 BC |
|----------|----------|-----------|
| `ProjectService` | 创建/管理研究项目 | 靶点发现（协调者） |
| `TargetService` | 提交靶点基因、查看进度 | BC1, BC2, BC3 |
| `AnalysisService` | 触发/监控/重试分析阶段 | BC1, BC2, BC3 |
| `ReportService` | 生成/导出研究报告 | BC3 |
| `ComplianceService` | 数据完整性检查 | 所有 BC |
| `AuditService` | 审计日志查询 | 所有 BC |
| `AuthService` | 用户认证授权 | 独立 |
| `NotificationService` | 阶段完成通知 | 独立 |

### 5.6 L6: 用户接入层 (Access Layer)

**五种接入方式，统一暴露 L5 的应用服务**：

| 通道 | 技术 | 用途 | 现状 |
|------|------|------|------|
| **Web Dashboard** | Vue 3 + Naive UI | 研究人员可视化界面 | 框架已有，需贯通数据 |
| **MCP Server** | @modelcontextprotocol/sdk | AI Agent 直接调用 | 已实现（基础） |
| **REST API** | Hono | 外部系统/前端集成 | 已实现（基础） |
| **CLI (scale)** | Citty | 开发者/CI 使用 | 已实现（丰富） |
| **Agent Adapters** | 12 个适配器 | 多 Agent 框架接入 | 已实现（最多） |

---

## 6. 核心决策记录 (ADR)

### ADR-001: 选择模块化单体而非微服务

**Status**: Accepted

**Context**:
团队规模有限（推测 1-5 人），医学研究管线的数据流具有强顺序依赖（表达→筛选→调研），不适合拆分为独立服务。过早微服务化会增加运维复杂度，延缓交付。

**Decision**:
保持模块化单体架构，通过 TypeScript 模块边界实现逻辑隔离。使用 SCALE 已有的依赖方向规则（api → modules → artifact → core）。

**Consequences**:
- **更容易**: 部署、调试、事务管理、IDE 导航
- **更困难**: 独立扩展特定瓶颈模块、多团队并行开发
- **何时重新评估**: 团队超过 8 人或单模块成为明确性能瓶颈时

---

### ADR-002: Python-TS 双语言桥接而非重写

**Status**: Accepted

**Context**:
核心引擎是 TypeScript，医学分析依赖 Python 科学计算生态（scipy, statsmodels, biopython）。重写为单一语言成本极高且丢失生态优势。

**Decision**:
通过标准化 JSON 协议桥接 Python 子进程。Python 侧保持纯计算职责（输入 JSON → 计算 → 输出 JSON），TS 侧负责编排、持久化、API 暴露。

**Consequences**:
- **更容易**: 利用 Python 科学计算生态、渐进式迁移、Python 分析师可独立维护
- **更困难**: 跨语言类型安全需要手动维护 Schema、调试链路更长、部署需要两个运行时
- **桥接协议**: 必须使用 JSON Schema 严格定义输入输出，自动生成 Python dataclass 和 TS interface

---

### ADR-003: PostgreSQL 作为研究数据仓库

**Status**: Accepted

**Context**:
当前 SQLite 仅用于引擎内部状态，无法支撑研究数据的复杂查询和多用户并发。ClickHouse 适合大规模 OLAP 但作为主库过于重。

**Decision**:
引入 PostgreSQL 作为研究数据主仓库。Phase 2 引入 ClickHouse 作为 OLAP 补充（大规模组学数据分析）。

**Consequences**:
- **更容易**: 事务一致性、JSONB 支持半结构化数据、成熟 ORM 支持、全文搜索
- **更困难**: 新增运维组件、需要数据库迁移策略、本地开发环境配置增加
- **SQLite 保留**: 继续用于 SCALE 引擎的 Artifact/FSM 内部状态（零部署优势）

---

### ADR-004: DAG 工作流编排而非 Nextflow

**Status**: Accepted

**Context**:
生命科学领域已有成熟的 Nextflow/Snakemake 工作流管理器。但 SCALE 引擎已有自己的 DAG Builder 和 WorkflowOrchestrator，且需要与 Agent 系统、门禁系统深度集成。

**Decision**:
继续使用 SCALE 原生 DAG 编排，将 Nextflow 的最佳实践（模块化、检查点、容器化）吸收到 SCALE 的 Pipeline Runner 中。

**Consequences**:
- **更容易**: 与 SCALE Shield/Orchestrator/Cortex 三引擎无缝集成、Agent 调度能力
- **更困难**: 无法直接复用 nf-core 社区管道、生命科学领域的标准化程度不如 Nextflow
- **何时重新评估**: 如果需要直接运行 nf-core 管道（如 RNA-seq 处理），考虑引入 Nextflow 作为子编排器

---

## 7. 数据架构

### 7.1 数据流

```
用户输入靶点基因
    ↓
[DataSourceAdapter] → 调用 GTEx/TCGA/HPA API → 带断路器和限流
    ↓
[标准化层] → 统一 DataResponse DTO → 写入 Redis 缓存 + PostgreSQL
    ↓
[领域引擎] → 表达分析 / 生存分析 / 免疫浸润 → 生成 TargetExpression
    ↓
[门禁检查] → 数据完整性验证 → 统计显著性验证
    ↓
[下一阶段] → 靶点筛选 → 深度调研 → 商业规划
    ↓
[报告生成] → 结构化报告 → Dashboard 展示 / PDF 导出
    ↓
[审计日志] → 记录每步操作 → 满足 ALCOA+ 合规
```

### 7.2 数据完整性策略 (ALCOA+)

| 原则 | 实现方式 |
|------|----------|
| **A**ttributable (可归属) | 每条分析记录关联操作者和时间戳 |
| **L**egible (清晰可读) | 结果存储为结构化 JSON + 人类可读 Markdown |
| **C**ontemporaneous (同步) | EventBus 实时记录，分析完成即持久化 |
| **O**riginal (原始) | 原始 API 响应保留在 `data_source_cache` |
| **A**ccurate (准确) | 门禁验证数据准确性（p-value 阈值、记录数校验） |
| **+C**omplete (完整) | DAG 检查点确保不丢失阶段结果 |
| **+C**onsistent (一致) | 标准化 DTO 确保跨数据源格式一致 |
| **+E**nduring (持久) | PostgreSQL WAL + 定期备份 |
| **+A**vailable (可用) | 多副本 + Redis 缓存降级策略 |

---

## 8. 合规与安全

### 8.1 合规目标

| 标准 | 适用场景 | 当前状态 | 目标 |
|------|----------|----------|------|
| **21 CFR Part 11** | FDA 申报相关研究 | 未实现 | Phase 2 就绪 |
| **HIPAA** | 涉及 PHI 的研究 | 未实现 | Phase 2 评估 |
| **GDPR** | 欧盟数据主体 | 未实现 | Phase 2 评估 |
| **GAMP5** | 软件验证 | 未实现 | Phase 3 |

### 8.2 Phase 2 合规架构

```
┌────────────────────────────────────────────────┐
│  认证层                                         │
│  - JWT + Refresh Token                         │
│  - 双因素认证 (21 CFR Part 11 要求)             │
│  - RBAC: Admin / Researcher / Viewer / Auditor  │
├────────────────────────────────────────────────┤
│  审计追踪层                                     │
│  - 不可篡改的审计日志 (Append-only)             │
│  - 时间戳 + 操作者 + 操作类型 + 前后值          │
│  - 独立于业务数据库存储                          │
├────────────────────────────────────────────────┤
│  数据完整性层                                   │
│  - 校验和 (SHA-256) 对关键分析结果              │
│  - 数据版本管理 (类似 Git DAG)                  │
│  - 变更审批工作流                                │
└────────────────────────────────────────────────┘
```

---

## 9. 可扩展性策略

### 9.1 水平维度

| 策略 | 技术 | 触发条件 |
|------|------|----------|
| API 请求并发 | Redis 队列 + Worker Pool | 单靶点分析 > 100 并发 |
| 批量靶点处理 | DAG 分片 + 并行 Stage | 单次研究 > 50 个靶点 |
| 大规模组学查询 | ClickHouse OLAP | 数据量 > 1TB |

### 9.2 垂直维度

| 策略 | 技术 | 触发条件 |
|------|------|----------|
| API 缓存 | Redis TTL + ETag | NCBI 速率限制触发 |
| 本地数据镜像 | Parquet 文件 + DuckDB | 频繁查询相同数据集 |
| 预计算聚合 | Materialized View | Dashboard 加载 > 5s |

### 9.3 未来微服务拆分预设

当团队和规模增长到需要微服务时，已清晰的模块边界允许以下拆分路径：

```
SCALE 引擎 (TS) ←→ 网关 ←→ 表达分析服务 (Python)
                          ←→ 靶点筛选服务 (Python)
                          ←→ 深度调研服务 (TS + Python)
                          ←→ 报告生成服务 (TS)
                          ←→ 合规审计服务 (TS)
```

---

## 10. 三阶段演进路线图

### Phase 1: 管线打通 (Q3 2026 — Q4 2026)

**目标**: 端到端跑通一个靶点的完整 4-Stage Pipeline。

| 任务 | 优先级 | 预估工期 | 交付标准 |
|------|--------|----------|----------|
| Python-TS 桥接层实现 | P0 | 3 周 | JSON Schema 定义 + 双向通信测试通过 |
| 4-Stage Pipeline 重建 | P0 | 6 周 | 每个阶段有真实数据产出 |
| API 客户端修复验证 | P0 | 4 周 | GTEx/TCGA/HPA 返回非空结果 |
| LLM 集成真实调用 | P0 | 3 周 | `simulateExecution` 替换为真实调用 |
| Dashboard 数据贯通 | P1 | 2 周 | 展示真实分析结果 |
| E2E Smoke Tests | P1 | 1 周 | CLI 输入靶点 → Dashboard 看到报告 |

**Phase 1 验证标准**: `scale target analyze TP53` → 4 个阶段全部完成 → Dashboard 可视化结果。

### Phase 2: 规模化与合规 (Q1 2027 — Q3 2027)

**目标**: 支持批量靶点处理、数据完整性和基础合规。

| 任务 | 优先级 | 预估工期 | 交付标准 |
|------|--------|----------|----------|
| PostgreSQL 迁移 | P0 | 4 周 | 研究数据从 SQLite 迁移到 PostgreSQL |
| 审计追踪系统 | P0 | 3 周 | 不可篡改操作日志 |
| RBAC 权限体系 | P0 | 3 周 | 4 种角色权限控制 |
| ClickHouse OLAP | P1 | 4 周 | 大规模组学数据查询优化 |
| 批量靶点处理 | P1 | 3 周 | 100+ 靶点并行分析 |
| 数据缓存策略 | P2 | 2 周 | Redis 缓存减少 80% API 调用 |

### Phase 3: AI 驱动与开放生态 (Q4 2027 — 2028)

**目标**: LLM 辅助研究、知识图谱、开放生态。

| 任务 | 优先级 | 预估工期 | 交付标准 |
|------|--------|----------|----------|
| PubMed RAG 引擎 | P0 | 6 周 | 基于检索增强的文献综述 |
| 多组学整合分析 | P1 | 8 周 | 基因组 + 转录组 + 蛋白组整合 |
| 知识图谱 (Neo4j) | P1 | 6 周 | 靶点-疾病-药物关系图谱 |
| 插件 SDK / MCP 扩展 | P2 | 4 周 | 第三方可开发分析插件 |
| 假设生成 AI Agent | P2 | 6 周 | LLM 辅助生成研究假设 |
| 开放 API + SDK | P2 | 4 周 | 外部系统可调用分析能力 |

---

## 11. 风险矩阵

| 风险 | 概率 | 影响 | 缓解策略 |
|------|------|------|----------|
| 外部 API 不稳定或废弃 | 高 | 高 | 本地缓存 + 镜像数据 + 断路器模式 |
| Python-TS 桥接层维护成本 | 中 | 中 | 严格 JSON Schema + 自动测试 + 双向 contract test |
| LLM 调用成本超预期 | 中 | 中 | Token 预算控制 + 缓存策略 + 低成本模型降级 |
| 合规需求变更 | 中 | 高 | 合规层解耦 + 配置化规则引擎 |
| 团队规模增长超出单体承载 | 低 | 高 | 已预留模块边界，Phase 3 可拆分微服务 |
| 生物信息学领域知识不足 | 中 | 中 | 与领域专家结对 + 借鉴 OpenTargets/cBioPortal 设计 |

---

## 附录 A: 竞品架构参考

| 竞品 | 架构模式 | 核心优势 | 可借鉴点 |
|------|----------|----------|----------|
| **OpenTargets** | 微服务 (Scala/React) | GraphQL API、证据评分框架、20+ 数据源整合 | 数据源标准化、证据聚合算法 |
| **cBioPortal v7** | 微服务 (Java/ClickHouse) | 列式 OLAP、癌症基因组数据可视化 | ClickHouse 数据架构、前端可视化组件 |
| **i2b2** | 星型模式数据仓库 | 本体驱动架构、灵活概念维度 | 医学本体管理、维度建模 |
| **BioRAG** | RAG 架构 | 2200 万论文索引、迭代检索 | RAG 管线设计、文献检索优化 |

---

*本文档随项目演进而更新。每个 ADR 在实施后标记为 Accepted，在后续决策取代时标记为 Superseded。*
