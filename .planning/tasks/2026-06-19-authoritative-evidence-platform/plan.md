# Plan - 2026-06-19-authoritative-evidence-platform

Date: 2026-06-19
Level: CRITICAL

## Scope / Boundary

本任务只完成产品定义、架构设计和实施切片，不在同一任务中一次实现全部来源。

## Implementation Phases

1. 治理底座：项目、三层存储、manifest、统一实体、许可策略和审核状态机。
2. 适配器 SDK：白名单、下载、断点续传、hash、schema 漂移和固定对照。
3. 七维垂直切片：每维两个来源、方法卡、QC、标准化和图表。
4. 证据矩阵：后期整合、冲突、缺失和确定性筛选规则。
5. 情报证据包：文献、临床、监管、市场和专利。
6. 研究工作台：四阶段签署、项目对照、告警和审计。

情报证据包按以下子阶段实施：

1. Terminology Registry 和规范实体映射。
2. PubMed/MeSH 原始检索与 claim ledger。
3. 冻结人工基准上的 lexical/controlled-vocabulary/vector/entity 检索对比。
4. 研究设计、风险偏倚、证据确定性和适用性表。
5. 临床、监管、市场和专利事实包；医学与商业物理隔离。

知识图谱、创新 Agent 和外部商业模型不属于前四个子阶段的前置条件。

## Exception / Failure Paths

- 来源或许可失效：阻断并隔离。
- 格式漂移：禁用适配器版本。
- 对照失败：禁止下游使用。
- 授权数据导出：默认拒绝，按许可策略显式批准。
- 映射不确定：人工映射队列。
- 证据冲突：保留冲突，不自动消解。

## Rollback

每个阶段使用独立 schema 和迁移；旧医学工作流保持只读兼容，直到对应 V2 垂直切片通过
验收。不得通过覆盖 raw 数据回滚。

## Verification

- 架构与 ADR 评审。
- 每阶段独立 contract tests。
- 伪造下载、篡改 hash、schema 漂移、许可过期和对照失败的阻断测试。
- 上游变更导致审批失效的状态机测试。
- 无网络和无 LLM 模式下的本地重放测试。

## Progress

- [x] Phase 1 governance foundation vertical slice:
  source registry, three-layer artifact store, manifest integrity, licensing gate, review state
  machine, lineage invalidation, and HTTP reference adapter contract.
- [x] Phase 2 adapter SDK and one fixed NCBI GEO reference control.
- [ ] Phase 3 seven-omics vertical slices.
- [ ] Phase 4 evidence matrix and deterministic screening.
- [ ] Phase 5 intelligence evidence packs.
- [ ] Phase 6 research workbench.
