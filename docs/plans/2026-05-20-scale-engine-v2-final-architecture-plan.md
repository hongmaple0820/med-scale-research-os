# SCALE Engine V2.0 最终架构落地方案

日期：2026-05-20
状态：执行蓝图，尚未全部实现

## 核心结论

SCALE Engine V2.0 的目标不是彻底无人化，而是把主动发现、成本治理、供应链安全和自进化能力纳入可审计闭环：

> 主动发现问题，自动生成证据和修复建议；默认不自动改仓库、不自动提交、不自动发布。

所有自动化能力必须满足四个约束：

- 可观测：每个判断都有本地 evidence 和可追溯来源。
- 可限流：高成本、高权限能力必须有显式开关、范围和 timeout。
- 可回滚：自动生成的规则、baseline、hook 必须能撤销。
- 可接管：默认保留人工审核点，不能绕过 release、review、security 门禁。

`DiagnosticLoop.ts` 保持纯诊断模型，不升级成守护进程。主动巡检由新增 `BackgroundHunter` 编排，并调用 DiagnosticLoop 生成诊断 artifact。

## 不进入 V2.0 的能力

以下能力不进入 V2.0 默认实现，避免系统失控：

- 自动修改业务代码。
- 自动创建 PR。
- 自动发布。
- 自动把 rule 固化成 blocking hook。
- 全量扫描 `node_modules`。
- 让 VLM 单独决定是否阻断。
- 把 `DiagnosticLoop.ts` 改成 daemon。
- 把 provider-specific prompt cache 写死在 `ModelRouter`。

## Phase 1：Prompt Cache 与成本账本

### 目标

降低稳定治理上下文的重复成本，并把实际模型用量写入本地账本，而不是只估算 token。

### 改造范围

- `src/context/ContextBudget.ts`
- `docs/CONTEXT_BUDGET.md`
- 新增：`src/routing/PromptCachePolicy.ts`
- 新增：`src/runtime/ModelUsageLedger.ts`
- 后续 provider adapter 层接入 API usage 采集

### 设计原则

- 只缓存稳定前缀，默认只有 `always` 桶。
- `on-demand` 默认不缓存，除非同一任务内多次复用且内容 hash 稳定。
- `ModelRouter` 只负责选择模型，不负责拼 provider message。
- 缓存策略放在 provider request builder 或 adapter 层。
- 不支持缓存的 provider 降级为普通 usage ledger，不阻断工作流。

### Provider 兼容策略

| Provider | 处理方式 |
| --- | --- |
| Anthropic | 支持 `cache_control: { type: "ephemeral" }` 时标记稳定内容块 |
| OpenAI | 记录 usage 中的 `cached_tokens` |
| 其他 provider | 记录 input/output tokens 和 provider 名称，不假装有缓存 |

### 产物

- `PromptCachePolicy.resolve(contextPack)`
- `ModelUsageLedger.recordUsage(...)`
- `scale context budget` 增加缓存视角：
  - cache eligible tokens
  - estimated reusable tokens
  - provider cache status
  - actual cached/read tokens

### 验收

- 能看到 `always` token 数量和 cache eligible token。
- provider 返回 usage 时能记录 cache creation/read/cached token。
- provider 不支持缓存时不失败。

## Phase 2：Governance Dashboard 聚合增强

### 目标

复用现有 dashboard 能力，把 runtime、gate、metrics、eval、evolution 数据聚合成可行动的治理面板。

### 改造范围

- `src/workflow/TaskMetricsStore.ts`
- `src/output/GovernanceDashboard.ts`
- `src/dashboard/DashboardServer.ts`
- `src/api/cli.ts`
- 新增：`src/dashboard/MetricsAggregator.ts`

### 设计原则

- 不新增孤立的 `scripts/dashboard.mjs`。
- 复用现有 `scale dashboard` 和 artifact dashboard 能力。
- 每个图表都必须能追溯到本地 evidence 文件。
- dashboard 不只展示结果，还要指向下一步治理动作。

### 聚合来源

- `.scale/metrics/tasks.jsonl`
- gate evidence
- runtime evidence ledger
- command run ledger
- eval failure replay
- evolution stats
- resource governance report

### 核心指标

- 近 7 天任务数量。
- first pass rate。
- average fix iterations。
- gate failure distribution。
- command output compression/token savings。
- failure replay count。
- standards/security findings trend。
- unresolved hunt findings。

### 验收

- `scale dashboard render` 能生成 HTML。
- `scale metrics list` 与 dashboard 数据一致。
- dashboard 中的图表能追溯到 evidence 文件或 jsonl 记录。

## Phase 3：Background Hunter 只读主动巡检

### 目标

从被动诊断升级为主动发现，但第一版默认只读，不自动改代码。

### 改造范围

- 保持：`src/workflow/DiagnosticLoop.ts`
- 新增：`src/workflow/autonomous/BackgroundHunter.ts`
- 新增：`src/workflow/autonomous/HuntFindingStore.ts`
- 扩展：`src/api/cli.ts`

### CLI

```bash
scale hunt scan
scale hunt report
scale hunt diagnose <finding-id>
scale hunt ignore <finding-id>
```

### 巡检来源

- `EngineeringStandards`
- `ReviewAnalyzer`
- `SecurityGate`
- resource governance
- stale TODO / FIXME
- repeated failed command evidence
- command ledger 中的反复失败模式

### 行为边界

- 默认只读。
- 不自动调用 LLM 修复。
- 不自动写业务代码。
- 不自动提交 PR。
- 不修改用户工作树。
- 支持 ignore/baseline，避免重复噪音。

### 产物

- `HuntFinding`
- `HuntFindingStore`
- 由 finding 生成的 `DiagnosticLoopInput`
- recommended verification command
- suggested patch summary

### 验收

- 人为放入一个伪 token，`scale hunt scan` 能发现。
- 能生成 `DiagnosticLoopInput`。
- 不产生任何代码修改。
- ignore 后不会重复报告同一个 finding。

## Phase 4：供应链安全门禁

### 目标

把第三方依赖风险纳入安全门禁，同时避免全量扫描 `node_modules` 带来的高成本和高误报。

### 改造范围

- 新增：`src/guardrails/DependencyAuditor.ts`
- 扩展：`src/workflow/gates/GateSystem.ts`
- 新增配置：`.scale/security/dependency-policy.json`

### 策略

- 只扫描 lockfile diff 中新增或升级的包。
- 支持 allowlist 和 baseline。
- registry 网络不可用时可降级为 warning，strict 模式下可阻断。
- install scripts 和 bin scripts 优先级高于普通源码 heuristic。

### 审计维度

- `npm audit --json`
- package install scripts
- bin scripts
- dangerous API heuristic：
  - `eval`
  - `new Function`
  - suspicious network access
  - shell execution
- package metadata：
  - deprecated
  - recently published
  - maintainer change
  - repository missing or suspicious

### 门禁设计

不使用 `G6.5` 或 `G6.8` 这种小数编号。供应链安全作为 `G7 Security` 的 sub-gate：

- `G7.source`
- `G7.dependency`
- `G7.runtime-risk`

### 默认策略

| 模式 | 阻断条件 |
| --- | --- |
| compatibility | CRITICAL 阻断 |
| strict | CRITICAL 和 HIGH 阻断 |
| offline | 输出 warning evidence，除非 strict 要求阻断 |

### 验收

- 新增高危依赖时能阻断。
- 已 baseline 的旧风险不重复阻断。
- 无网络时可降级，不让普通本地验证不可用。

## Phase 5：Active Security 与 Visual Gate 条件启用

### 目标

增强动态验证能力，但只在项目显式提供运行条件时启用。

### 改造范围

- 新增：`src/guardrails/ActiveRedTeam.ts`
- 新增：`src/workflow/gates/VisualGate.ts`
- 扩展：`.scale/verification.json`

### Active Security 配置

```json
{
  "security": {
    "active": {
      "enabled": true,
      "baseUrl": "http://localhost:3000",
      "startCommand": "npm run dev",
      "targets": ["/api/login", "/api/users"]
    }
  }
}
```

### Visual Gate 配置

```json
{
  "visual": {
    "enabled": true,
    "baseUrl": "http://localhost:5173",
    "specPath": "docs/ui/UI-SPEC.md",
    "routes": ["/", "/settings"]
  }
}
```

### 行为规则

- 没配置则 `SKIPPED`，写 evidence。
- 配置了但启动失败则 `FAILED`。
- 动态安全测试必须有 timeout、target 范围和最大请求数。
- 视觉报告先输出 finding，不直接让 VLM 结果作为唯一阻断依据。
- VLM 判断只能辅助，最终阻断必须来自结构化阈值或人工确认。

### 验收

- 后端库不会被视觉门禁拖慢。
- 前端项目可以生成截图和视觉报告。
- 动态安全测试有明确 timeout 和 target 范围。

## Phase 6：Evolution Shadow Mode

### 目标

让系统从失败中学习，但避免把偶发失败自动固化成错误 hook。

### 改造范围

- `src/evolution/AutoDefectCreator.ts`
- `src/evolution/EvolutionEngine.ts`
- `src/workflow/gates/GateSystem.ts`
- 新增：`src/evolution/RuleMaturity.ts`

### 规则流转

```text
Gate Failure
  -> Defect
  -> Lesson
  -> Proposed Rule
  -> Shadow Rule
  -> Candidate Hook
  -> Approved Blocking Hook
```

### 关键限制

- Gate 连续失败 3 次可以生成 Defect。
- 不允许直接生成 blocking hook。
- 新规则先进入 shadow mode，只记录命中，不阻断。
- blocking hook 必须来自 approved rule。

### 晋级条件

- 命中次数 >= 10。
- 有至少 1 条真实 defect evidence。
- 误报率可接受。
- 有 rollback 方法。
- 人工批准或显式策略批准。

### 验收

- 连续失败能自动创建 defect。
- `EvolutionEngine.runCycle()` 能生成 proposed/shadow rule。
- `.scale/hooks` 下 blocking hook 必须来自 approved rule。
- 未批准规则不阻断开发流程。

## 推荐门禁模型

```text
G0  Scope / Task Boundary
G1  Exploration
G2  Planning
G3  TDD Evidence
G4  Build / Typecheck
G5  Lint
G6  Test / Coverage
G7  Security
    - source scan
    - dependency audit
    - active red team, optional
G8  Product Smoke
G9  Visual, optional
G10-G15 Meta Governance
```

内部子门禁使用 structured evidence 表达，不引入 `G6.5`、`G6.8` 等小数编号。

## 推荐执行顺序

| 版本 | 范围 | 输出 |
| --- | --- | --- |
| V2.0.1 | Prompt cache policy、usage ledger、dashboard 聚合 | 可量化成本账本和治理面板 |
| V2.0.2 | Background Hunter 只读版、hunt CLI、finding baseline | 主动巡检但不改代码 |
| V2.0.3 | DependencyAuditor、G7 dependency sub-gate | 供应链风险门禁 |
| V2.0.4 | ActiveRedTeam 和 VisualGate 条件启用 | 动态安全和视觉验证 |
| V2.0.5 | Evolution shadow mode、gate failure -> defect 管线 | 可控自进化闭环 |

## 审批红线

正式进入实现前，必须确认以下红线不被突破：

1. 主动巡检默认只读。
2. 自进化默认 shadow，不默认 blocking。
3. 高权限动作必须有 evidence、配置开关和人工确认。
4. 所有自动生成规则都必须能 rollback。
5. 不把 provider 特性写死进核心路由层。

## 最终预期收益

按本方案落地后，SCALE Engine V2.0 应提供以下实质提升：

- 降低稳定治理上下文的重复 token 成本。
- 用真实 usage 和 evidence 证明成本变化。
- 主动发现技术债、安全风险和流程债。
- 增强供应链风险治理。
- 让动态安全和视觉验证进入可配置门禁。
- 让自进化从“直接阻断”变成“先观察、再晋级、可回滚”的成熟度模型。

