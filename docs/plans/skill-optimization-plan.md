# SCALE Engine Skill 优化方案

> 基于《从 7 个顶级 Skill 中提炼的模式与最佳实践》分析
> 目标：将 SCALE Engine Phase Commands 转换为标准 Skill 格式，提高 LLM 遵从率

---

## 一、现状分析

### 1.1 当前架构

| 组件 | 实现方式 | 问题 |
|------|----------|------|
| Phase Commands | CLI 命令 + FSM | 无标准 Skill 格式，LLM 无法自动加载 |
| PhasePromptRegistry | TypeScript 代码 | 模板库，非 Skill，缺乏触发描述 |
| WorkflowEngine | 认知脚手架代码 | 有逻辑但无借口反驳表 |
| EvidenceStore | SQLite + JSON | 有持久化但无接力棒协议 |
| L6 Evolution | 设计但未实现 | 缺少跨 session 持久化机制 |

### 1.2 对比分析

| 文章模式 | SCALE 对应 | 差距 |
|----------|------------|------|
| 模式 1：线性流程 | SHIP Phase | 有步骤但无安全默认值、负面指令 |
| 模式 2：决策树 | PhasePromptRegistry | 有 4 个 pack 但无决策树导航 |
| 模式 3：循环迭代 | VERIFY Phase | 有循环但无借口反驳表 |
| 模式 4：接力棒循环 | Evidence | 有存储但无 next-prompt 协议 |
| 模式 5：多阶段+检查点 | 6 Phase FSM | 有阶段但无 Decision Point |
| 思维框架 | REVIEW Phase | 有 Karpathy 原则但无量化阈值 |

---

## 二、优化目标

### 2.1 核心目标

1. **Phase Commands → 标准 Skill 文件**：让 LLM 能通过 description 自动识别并加载
2. **添加借口反驳表**：堵死 LLM 在 VERIFY/REVIEW 阶段偷懒的所有路径
3. **添加量化阈值**：给 LLM 硬性的最低标准
4. **实现接力棒协议**：支持跨 session 持久化（L6 Evolution）
5. **决策树导航**：让用户快速选择正确的 Phase/Pack

### 2.2 量化目标

| 指标 | 当前 | 目标 |
|------|------|------|
| Skill 文件数量 | 0 | 7（6 Phase + 1 Registry） |
| 借口反驳表 | 0 | 3（VERIFY/REVIEW/Evolution） |
| 量化阈值 | 1（Coverage ≥80%） | 5（Ambiguity/Lint/Tests/Coverage/Security） |
| Decision Point | 0 | 6（每个 Phase 一个） |
| 接力棒文件 | 0 | 5（baton 目录结构） |

---

## 三、Skill 目录结构设计

### 3.1 目录结构

```
.claude/skills/
├── scale-engine/              # SCALE Engine Skills 套件
│   ├── SKILL.md               # 套件入口（决策树导航）
│   │
│   ├── phases/                # 6 个 Phase Skills
│   │   ├── define/
│   │   │   ├── SKILL.md       # DEFINE Phase（模式 1 + 决策树）
│   │   │   ├── references/
│   │   │   │   ├── socratic-questions.md
│   │   │   │   └── ambiguity-thresholds.md
│   │   │   └── scripts/
│   │   │       └── extract-spec.ts
│   │   │
│   │   ├── plan/
│   │   │   ├── SKILL.md       # PLAN Phase（模式 1）
│   │   │   └── references/
│   │   │       └── consensus-planner.md
│   │   │
│   │   ├── build/
│   │   │   ├── SKILL.md       # BUILD Phase（模式 1）
│   │   │   └── scripts/
│   │   │       └── task-creation.ts
│   │   │
│   │   ├── verify/
│   │   │   ├── SKILL.md       # VERIFY Phase（模式 3 + 借口反驳表）
│   │   │   ├── references/
│   │   │   │   ├── gate-specifications.md
│   │   │   │   └── coverage-threshold.md
│   │   │   └── resources/
│   │   │       └── verification-checklist.md
│   │   │
│   │   ├── review/
│   │   │   ├── SKILL.md       # REVIEW Phase（思维框架 + 量化阈值）
│   │   │   ├── references/
│   │   │   │   ├── karpathy-principles.md
│   │   │   │   └── finding-severity.md
│   │   │   └── resources/
│   │   │       └── review-checklist.md
│   │   │
│   │   └── ship/
│   │   │   ├── SKILL.md       # SHIP Phase（模式 1 + 安全默认值）
│   │   │   └── scripts/
│   │   │       ├── git-flow.sh
│   │   │       └── rollback.sh
│   │
│   ├── vibe-templates/
│   │   ├── SKILL.md           # 模板库入口（模式 2 决策树）
│   │   └── references/
│   │       ├── idea-validate.md
│   │       ├── deep-research.md
│   │       ├── prd-mvp.md
│   │       ├── design-system.md
│   │       ├── agents-design.md
│   │       └── build-implementation.md
│   │
│   └── evolution/
│   │   ├── SKILL.md           # L6 Evolution（模式 4 接力棒循环）
│   │   └── references/
│   │       ├── lesson-extraction.md
│   │       ├── rule-validation.md
│   │       └── hook-activation.md
│   │
│   └── resources/
│       ├── decision-tree.md   # Phase 选择决策树
│       ├── baton-protocol.md  # 接力棒文件协议
│       └── time-estimates.md  # 各 Phase 时间预估
│
└── .scale/
    └── baton/                 # 接力棒状态目录
        ├── current-session.md
        ├── defects-found.md
        ├── lessons-learned.md
        ├── rules-proposed.md
        ├── hooks-activated.md
        └── next-prompt.md     # ⚠️ 关键：续命文件
```

---

## 四、各 Skill 详细设计

### 4.1 套件入口 SKILL.md（决策树导航）

```yaml
---
name: scale-engine
description: SCALE Engine's 6-phase workflow for shipping quality features. 
  Use when starting a new project, implementing features, fixing bugs, 
  or when user mentions any phase (define/plan/build/verify/review/ship).
  Automatically selects the correct phase based on user intent.
type: workflow
best_for:
  - new feature implementation
  - bug fixes with quality gates
  - refactoring with verification
  - product development lifecycle
scenarios:
  - User says: "I have an idea for..."
  - User says: "Start implementing..."
  - User says: "Verify the changes"
  - User says: "Ship this feature"
estimated_time: varies by phase (see time-estimates.md)
---
```

**正文设计**：

```markdown
# SCALE Engine — Phase Decision Tree

## Quick Phase Selection

用户意图 → 推荐的 Phase：

### "我有一个想法/需求"
→ **DEFINE Phase** (`scale define`)
- 目标：将模糊想法转化为可执行的 Spec
- 产出：Spec.md + Ambiguity Score
- 时间：5-15 分钟

### "我需要规划实现方案"
→ **PLAN Phase** (`scale plan <spec-id>`)
- 目标：设计技术方案 + 风险评估
- 产出：Plan.md + Rollback Strategy
- 时间：10-30 分钟

### "开始编码/实现"
→ **BUILD Phase** (`scale build <plan-id>`)
- 目标：创建 Task 并开始实现
- 产出：Task artifact + 工作目录
- 时间：30分钟-数小时

### "运行测试/验证质量"
→ **VERIFY Phase** (`scale verify <task-id>`)
- 目标：通过 G3-G7 质量门控
- 产出：Evidence records + Coverage report
- 时间：2-10 分钟

### "代码审查"
→ **REVIEW Phase** (`scale review <task-id>`)
- 目标：Karpathy Principles 审查 + 安全检查
- 产出：Review record + Findings report
- 时间：5-15 分钟

### "发布/提交"
→ **SHIP Phase** (`scale ship <task-id>`)
- 目标：安全的 git commit + Honest Delivery Report
- 产出：Commit hash + Delivery report
- 时间：1-5 分钟

## Vibe Templates（快速启动）

### "给我一个模板"
→ **Vibe Templates** (`scale vibe --phase <phase> --pack <pack>`)

可选 Pack：
- `full-mvp`：完整 MVP 流程（6 phases）
- `quick-prototype`：快速原型（prd + agents + build）
- `developer-path`：开发者路径（跳过 idea）
- `vibe-coder-path`：非技术用户路径

## Phase Flow Diagram

DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP

每个 Phase 都有：
- 前置条件（必须满足才能进入）
- Decision Point（Go/No-Go 决策）
- 时间影响（No 路径的延迟成本）

详见 `resources/decision-tree.md`。
```

---

### 4.2 VERIFY Phase SKILL.md（模式 3：循环迭代 + 借口反驳表）

这是最重要的改进——堵死 LLM 偷懒的所有路径。

```yaml
---
name: verify-phase
description: Run quality gates G3-G7 after implementation. Use when code 
  is written and needs verification, when user says "test this", "run tests",
  "verify the implementation", "check quality gates". MUST run before 
  review phase — no code ships without verification.
type: workflow
best_for:
  - new feature verification
  - bug fix verification
  - refactoring verification
  - before code review
scenarios:
  - User says: "Run tests"
  - User says: "Check if the code is good enough"
  - User says: "Verify before review"
  - After BUILD phase completion
estimated_time: 2-10 minutes
---
```

**正文设计**：

```markdown
# VERIFY Phase — The Iron Law

## Core Principle
**No code ships without passing ALL gates.**

这不是建议，是不可违反的铁律。如果任何门控失败，必须修复后重新验证。

## The Verification Loop

### Gate G3 — Build ✅
检查代码能否编译/构建。

**命令**：
```bash
pnpm build
```

**验证标准**：
- Exit code 必须为 0
- 无编译错误
- 无类型错误

**Verify G3**: 检查 exit code。如果 ≠0 → **停止**，修复构建错误，回到 G3。

---

### Gate G4 — Lint ✅
检查代码风格和质量。

**命令**：
```bash
pnpm lint
```

**验证标准**：
- Exit code 必须为 0
- 无 lint 错误
- 无 lint 警告（除非明确允许）

**Verify G4**: 检查 exit code。如果 ≠0 → **停止**，修复 lint 问题，回到 G4。

---

### Gate G5 — Tests ✅
检查所有测试通过。

**命令**：
```bash
pnpm test
```

**验证标准**：
- 所有测试必须 pass（绿色）
- 无 skipped tests（除非明确记录原因）
- 无 focused tests（.only）

**Verify G5**: 检查测试输出。如果有 failures → **停止**，修复测试，回到 G5。

---

### Gate G6 — Coverage ≥80% ✅
检查测试覆盖率达标。

**命令**：
```bash
pnpm coverage
```

**验证标准**：
- 总覆盖率必须 ≥80%
- 关键模块覆盖率必须 ≥70%
- 新代码覆盖率必须 ≥85%

**量化阈值**：
| 覆盖率 | 判断 | 行动 |
|--------|------|------|
| < 70% | FAIL | 必须增加测试 |
| 70-79% | WARN | 建议增加测试 |
| ≥ 80% | PASS | 可以继续 |

**Verify G6**: 检查覆盖率数字。如果 <80% → **停止**，增加测试，回到 G5。

---

### Gate G7 — Security ✅
检查安全漏洞。

**命令**：
```bash
pnpm security-check
```

**验证标准**：
- 无 CRITICAL severity findings
- 无 HIGH severity findings（除非明确评估风险）
- 已知漏洞必须修复或有 mitigations

**Verify G7**: 检查安全报告。如果有 CRITICAL → **停止**，修复漏洞，回到 G7。

---

### Repeat 循环
如果任何 Gate 失败：
1. 修复问题
2. 从失败的 Gate 重新开始
3. 不要跳过任何 Gate

---

## Rationalizations — 借口反驳表

LLM 可能会找借口逃避验证。**不接受这些借口**：

| 借口 | 反驳 |
|------|------|
| "The test is flaky" | Flaky tests 是真实的 bug。不稳定的行为就是错误的行为。修复它。 |
| "Coverage is close enough (78%)" | 78% 不是 80%。差 2% 就是差。增加测试直到达标。 |
| "The lint error is minor" | Minor lint errors 今天是 minor，明天变成 debt。修复它。 |
| "I'll fix it after ship" | 不可能。没有代码能在未验证的情况下 ship。现在修复。 |
| "The build error is in unrelated code" | 你的代码触发了构建失败。即使错误在其他文件，你也需要解决它。 |
| "Security warning is just informational" | Informational 今天是 informational，明天是 vulnerability。评估并处理。 |
| "This is a quick prototype" | Prototype 也需要验证。快速 ≠ 低质量。 |
| "The user asked me to skip tests" | 用户不懂质量风险。作为专业工程师，你有责任解释并坚持验证。 |
| "Tests take too long" | 测试时间是投资。节省时间的代价是未来的 bug。运行测试。 |
| "I already mentally verified it" | Mental verification 是幻觉。工具验证才是证据。运行命令。 |
| "The coverage threshold is arbitrary" | 80% 是行业标准阈值。低于这个值的代码在统计上有更多 bug。达标。 |
| "Security scan found 0 vulnerabilities" | 那太好了！Gate G7 PASS。继续。 |

---

## Completion Checklist — 退出条件

验证完成前，必须全部打勾：

- [ ] **G3 Build**: passed (exit code 0)
- [ ] **G4 Lint**: passed (exit code 0)
- [ ] **G5 Tests**: passed (all tests green)
- [ ] **G6 Coverage**: ≥80% threshold met
- [ ] **G7 Security**: no CRITICAL findings
- [ ] **Evidence persisted**: 验证结果写入 EvidenceStore

**只有全部打勾才能进入 REVIEW Phase。**

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Build fails with type error | 运行 `pnpm tsc --noEmit` 定位具体类型错误 |
| Test hangs indefinitely | 使用 `--timeout 30000` 设置超时 |
| Coverage report missing | 确保 `coverage/` 目录存在，检查覆盖率工具配置 |
| Security scan crashes | 使用 `--path src/` 缩小扫描范围 |
| Flaky test | 隔离运行 `pnpm test --grep "test-name"` 多次验证 |
| Low coverage on specific file | 针对该文件编写更多测试用例 |

---

## Decision Point

**Go/No-Go 决策**：

- ✅ **Go（继续 REVIEW）**: 所有 Gates PASS + Checklist 全部打勾
- ❌ **No（回到修复）**: 任何 Gate FAIL + 时间影响：+2-10 分钟

**时间影响**：
| 失败的 Gate | 修复时间预估 |
|--------------|--------------|
| G3 Build | 5-30 分钟 |
| G4 Lint | 2-10 分钟 |
| G5 Tests | 10-60 分钟 |
| G6 Coverage | 15-45 分钟 |
| G7 Security | 30-120 分钟 |
```

---

### 4.3 REVIEW Phase SKILL.md（思维框架 + 量化阈值）

控制 LLM "怎么想"而非"做什么"。

```yaml
---
name: review-phase
description: Code review with Karpathy Principles and security analysis. 
  Use after VERIFY phase passes, when user says "review this code", 
  "check code quality", "security audit". Deep analysis, not quick scan.
type: workflow
best_for:
  - code quality review
  - security review
  - architecture review
  - before shipping
scenarios:
  - User says: "Review the code"
  - User says: "Security audit"
  - After VERIFY phase passes
estimated_time: 5-30 minutes
---
```

**正文设计**：

```markdown
# REVIEW Phase — Thinking Framework

## Purpose
这个 Skill 控制 LLM 的**思维方式**，而非具体的操作步骤。

目标：进行深度分析，而非快速扫描。

## When to Use / When NOT to Use

**Use when**:
- VERIFY phase 已全部通过
- 代码需要质量审查
- 需要安全审计
- 用户明确要求 review

**NOT Use when**:
- VERIFY phase 还有失败的 Gate（回到 VERIFY）
- 代码还在编写中（回到 BUILD）
- 只需要快速检查（用 VERIFY）

---

## Karpathy Principles — 8 条核心原则

### Principle 1: 列出假设
**量化阈值**：每个改动至少列出 3 个假设。

<Good>
假设 1：用户已登录
假设 2：数据库连接正常
假设 3：输入已验证
</Good>

<Bad>
假设代码会正常工作。
</Bad>

---

### Principle 2: 验证假设
每个假设必须有证据支撑。

**量化阈值**：
- 假设数量：≥3 个
- 有证据支撑的假设：≥50%

---

### Principle 3: 最小化改动
改动范围越小越好。

**量化阈值**：
- 新增文件数：≤5
- 新增代码行数：≤200
- 新增依赖数：≤2

如果超过阈值 → 考虑拆分任务。

---

### Principle 4: 追踪改动
每个改动必须可追溯到原始需求。

**量化阈值**：
- 追踪覆盖率：100%（所有改动都有需求链接）
- Spec → Plan → Task → Code 链路完整

---

### Principle 5: 有验证目标
每个改动必须有明确的验证标准。

**量化阈值**：
- 每个 feature 至少 1 个 acceptance test
- 每个 bug fix 至少 1 个 regression test

---

### Principle 6: 防止额外 feature
不要添加需求中没有的功能。

**Anti-patterns**：
- "顺便优化了一下..."
- "顺手加了个日志..."
- "顺便重构了..."

如果发现额外功能 → 删除或拆分到新 Task。

---

### Principle 7: 安全意识
检查 OWASP Top 10 漏洞。

**量化阈值**：
- 扫描文件数：100%（所有改动的文件）
- CRITICAL findings：0
- HIGH findings：≤2（必须有 mitigation）

---

### Principle 8: 测试意识
测试先于实现（TDD）。

**量化阈值**：
- 测试覆盖率：≥80%
- 新代码覆盖率：≥85%
- 测试先行证据：有（从 EvidenceStore 检查）

---

## Finding Severity 标准

| Severity | 定义 | 行动 |
|----------|------|------|
| CRITICAL | 安全漏洞、数据丢失风险 | **BLOCK** — 必须修复才能 ship |
| HIGH | Bug、重大质量问题 | **WARN** — 应该修复 |
| MEDIUM | 可维护性问题 | **INFO** — 建议修复 |
| LOW | 风格问题 | **NOTE** — 可选 |

**判定标准**：

### CRITICAL
- 硬编码密钥（API key, password, token）
- SQL 注入漏洞
- XSS 漏洞
- 路径遍历漏洞
- 认证绕过
- 数据丢失风险（DROP, DELETE without backup）

### HIGH
- 空 catch 块
- 未处理的异常
- @ts-ignore 使用
- shell 执行（shell: true）
- dangerousInnerHTML
- 未经验证的用户输入

### MEDIUM
- any 类型使用
- 超过 50 行的函数
- 超过 800 行的文件
- 嵌套超过 4 层
- 缺少文档的公共 API

### LOW
- 命名不规范
- 缺少注释
- 格式问题

---

## Rationalizations — 借口反驳表

| 借口 | 反驳 |
|------|------|
| "This is just a style issue" | Style issues 今天是 style，明天是 debt。统一风格。 |
| "The security finding is theoretical" | Theoretical vulnerabilities become real exploits。修复它。 |
| "I inherited this bad code" | 你现在拥有这段代码。修复它或记录为 future task。 |
| "The test coverage is good enough" | "Good enough" 不是 ≥80%。达标。 |
| "This pattern is common in this project" | Common patterns can be common bugs。检查是否有同类问题。 |
| "I reviewed it mentally" | Mental review 是幻觉。运行 ReviewAnalyzer。 |

---

## Stability Rules — 反幻觉规则

1. **Never reshape evidence to fit assumptions**：证据决定判断，不是判断选择证据。
2. **Never skip CRITICAL findings**：CRITICAL 就是 BLOCK，没有例外。
3. **Never accept "I'll fix later"**：Later never comes。现在修复。
4. **Never lower thresholds without justification**：阈值是硬性标准。不达标就是不通过。

---

## Completion Checklist

- [ ] 所有改动文件已扫描
- [ ] Karpathy Principles 检查完成
- [ ] 安全扫描完成（G7）
- [ ] Finding Severity 正确分类
- [ ] CRITICAL findings: 0
- [ ] HIGH findings: ≤2（或有 mitigation）
- [ ] Review record 写入 ReviewStore

**只有 CRITICAL=0 才能进入 SHIP Phase。**

---

## Decision Point

- ✅ **Go（继续 SHIP）**: CRITICAL=0 + Checklist 全部打勾
- ❌ **No（回到修复）**: CRITICAL>0 + 时间影响：+30-120 分钟
```

---

### 4.4 SHIP Phase SKILL.md（模式 1：线性流程 + 安全默认值）

```yaml
---
name: ship-phase
description: Ship verified and reviewed code with git commit and Honest 
  Delivery Report. Use after REVIEW phase passes, when user says "ship this",
  "commit this", "deploy", "push to main". Safe git flow, never force push.
type: workflow
best_for:
  - feature release
  - bug fix release
  - code delivery
  - after review passes
scenarios:
  - User says: "Ship this feature"
  - User says: "Commit and push"
  - User says: "Release this"
  - After REVIEW phase passes
estimated_time: 1-5 minutes
---
```

**正文设计**：

```markdown
# SHIP Phase — Linear Flow with Safe Defaults

## Core Principle
**Always ship to preview/branch first, never directly to main.**

安全默认值：
- 默认创建 PR，不直接 merge
- 默认运行完整 git flow
- 默认验证 HEAD 未改变（使用 --no-commit 时）

---

## Prerequisites

SHIP Phase 必须满足：
- [ ] VERIFY Phase: 全部 Gates PASS
- [ ] REVIEW Phase: CRITICAL findings = 0
- [ ] Evidence persisted: 验证和审查记录完整

如果未满足 → 回到对应 Phase 修复。

---

## Quick Start（主流程）

### Step 1: Fetch and Sync
```bash
git fetch origin main
git checkout main
git pull origin main
```

**超时**：使用 60 秒超时。

---

### Step 2: Merge Feature Branch
```bash
git merge --no-ff <feature-branch>
```

**安全检查**：
- 使用 `--no-ff` 保留分支历史
- 不使用 `--force` 或 `-f`

---

### Step 3: Run Final Verification
```bash
pnpm test && pnpm coverage
```

**验证**：
- Tests: 必须全部 pass
- Coverage: 必须 ≥80%

如果失败 → **停止**，回到 VERIFY Phase。

---

### Step 4: Commit or Create PR

**Option A（直接 commit — 需要 --message 参数）**：
```bash
git commit -m "<commit-message>"
```

**Option B（创建 PR — 推荐）**：
```bash
gh pr create --title "<pr-title>" --body "<pr-body>"
```

**安全默认值**：优先创建 PR。

---

### Step 5: Push
```bash
git push origin main
```

**安全检查**：
- 不使用 `--force`
- 不使用 `-f`

---

### Step 6: Generate Honest Delivery Report
输出交付报告：

```
SHIP Phase Complete
- Commit: <commit-hash>
- Files: <count> files committed
- Evidence: VERIFY-xxx, REVIEW-xxx validated
- Coverage: <percentage>% met
- Security: No CRITICAL findings

Honest Delivery Report:
[PASS] All gates verified
[PASS] All evidence persisted
[PASS] No unreviewed files included
```

---

## Fallback（降级方案）

如果 CLI 命令失败：

1. **git merge 失败**：
   ```bash
   # 手动解决冲突
   git status
   # 编辑冲突文件
   git add <resolved-files>
   git commit
   ```

2. **gh pr create 失败**：
   ```bash
   # 手动 push，在 GitHub Web 创建 PR
   git push origin <branch>
   # 访问 https://github.com/.../pulls
   ```

3. **pnpm test 失败**：
   ```bash
   # 回到 VERIFY Phase
   scale verify <task-id>
   ```

---

## Negative Instructions — 明确禁止

- ❌ **Do not force push**: `git push --force` 禁止
- ❌ **Do not skip tests**: 必须运行 `pnpm test`
- ❌ **Do not commit unreviewed files**: 只 commit review 记录中的文件
- ❌ **Do not merge to main directly**: 优先创建 PR
- ❌ **Do not skip coverage check**: 必须 ≥80%

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Merge conflict | 手动解决：`git status` → 编辑文件 → `git add` → `git commit` |
| Tests fail after merge | 回到 VERIFY Phase |
| Coverage dropped | 回到 VERIFY Phase，增加测试 |
| gh CLI not found | 使用 Fallback：手动 push + Web 创建 PR |
| Permission denied | 检查 git 权限，或使用 SSH key |

---

## Decision Point

- ✅ **Go（Ship 成功）**: Commit/PR 创建 + Evidence 验证通过
- ❌ **No（回到修复）**: Verification 或 Review 失败 + 时间影响：+5-30 分钟
```

---

### 4.5 Evolution Skill（模式 4：接力棒循环）

```yaml
---
name: evolution-loop
description: Self-improve from defects and lessons. Use after fixing bugs,
  when user says "learn from this", "extract lessons", "create a rule",
  "prevent this bug again". Runs across multiple sessions using baton files.
type: workflow
best_for:
  - defect learning
  - knowledge extraction
  - rule creation
  - hook activation
scenarios:
  - User says: "Learn from this bug"
  - User says: "Create a rule from this lesson"
  - After CRITICAL bug fix
  - After repeated similar bugs
estimated_time: 15-60 minutes (may span sessions)
---
```

**正文设计**：

```markdown
# Evolution Loop — Baton System

## Overview
这个 Skill 跨越多个 session 工作，使用文件系统作为状态存储。

**关键机制**：`.scale/baton/next-prompt.md` 是续命文件。每次 session 结束前必须写入，否则循环断开。

---

## The Baton System

文件结构：
```
.scale/baton/
├── current-session.md    # 当前 session 状态
├── defects-found.md      # 发现的缺陷列表
├── lessons-learned.md    # 提取的经验教训
├── rules-proposed.md     # 提议的规则（待验证）
├── hooks-activated.md    # 激活的 hooks
└── next-prompt.md        # ⚠️ 下一步提示词（关键）
```

每个文件职责：
- `current-session.md`: Session ID + 进度状态
- `defects-found.md`: 缺陷列表（Defect ID + Description）
- `lessons-learned.md`: 教训列表（Pattern + Solution + Confidence）
- `rules-proposed.md`: 规则列表（Rule + Validation Count）
- `hooks-activated.md`: Hook 列表（Hook ID + Trigger）
- `next-prompt.md`: 下次 session 的启动提示词

---

## Execution Protocol — 6 步循环

### Step 1: Read the Baton ⚠️
读取 `.scale/baton/current-session.md`。

如果不存在 → 这是第一个 session，初始化：
```markdown
# Evolution Session
Session ID: EVOL-<timestamp>
Status: INITIALIZING
Started: <datetime>
Current Step: COLLECT_DEFECTS
```

---

### Step 2: Consult Context Files
根据当前 Step 读取对应文件：

| Current Step | 读取文件 |
|--------------|----------|
| COLLECT_DEFECTS | EventBus query for defect events |
| EXTRACT_LESSONS | `defects-found.md` |
| VALIDATE_LESSONS | `lessons-learned.md` |
| PROPOSE_RULES | `rules-proposed.md` |
| ACTIVATE_HOOKS | `hooks-activated.md` |

---

### Step 3: Execute Current Step

#### COLLECT_DEFECTS
从 EventBus 查询最近的 defect.opened 事件。

**量化阈值**：
- 最少 3 个缺陷才能提取教训
- 如果 <3 → 等待更多缺陷积累

输出到 `defects-found.md`：

```markdown
# Defects Found
- DEFECT-001: Empty catch block in auth.ts
- DEFECT-002: SQL injection vulnerability in query.ts
- DEFECT-003: Missing error handling in payment.ts
```

---

#### EXTRACT_LESSONS
分析每个缺陷，提取模式-解决方案。

**量化阈值**：
- 每个缺陷至少 1 个 Pattern
- 每个缺陷至少 1 个 Solution
- Confidence 分数：0.0-1.0

输出到 `lessons-learned.md`：

```markdown
# Lessons Learned

## Lesson L001
Pattern: Empty catch blocks silence errors
Solution: Always log or handle caught exceptions
Confidence: 0.85
Source: DEFECT-001
Validations: 0

## Lesson L002
Pattern: Raw string concatenation in SQL queries
Solution: Use parameterized queries
Confidence: 0.95
Source: DEFECT-002
Validations: 0
```

---

#### VALIDATE_LESSONS
检查 `rules-proposed.md` 中已有的验证计数。

**验证规则**：
- Lesson 验证 3 次后 → 可以成为 Rule
- 每次同类 bug 修复后 → 该 Lesson Validation +1

更新 `rules-proposed.md`：

```markdown
# Rules Proposed

## Rule R001 (Pending)
Content: Never use empty catch blocks
Lesson: L001
Validations: 2/3 (need 1 more)
Status: PENDING

## Rule R002 (Activated)
Content: Always use parameterized SQL queries
Lesson: L002
Validations: 3/3
Status: ACTIVATED
```

---

#### PROPOSE_RULES
将 Validations ≥3 的 Lessons 转为 Rules。

**Rule 格式**：
```markdown
## Rule R003
Content: <rule-content>
Lesson: <lesson-id>
Status: PROPOSED
Proposed: <datetime>
```

---

#### ACTIVATE_HOOKS
将已验证的 Rules 转为 Hooks。

**Hook 格式**：
```markdown
## Hook H001
Rule: R002
Trigger: "executeQuery.*\\+"
Action: BLOCK + MESSAGE: "Use parameterized queries"
File: src/guardrails/sql-injection-hook.ts
Activated: <datetime>
```

---

### Step 4: Integrate Results
更新所有 baton 文件，确保状态同步。

---

### Step 5: Update Documentation
将新的 Lessons/Rules/Hooks 写入知识库：
- Lessons → `docs/lessons/`
- Rules → `docs/rules/`
- Hooks → `src/guardrails/`

---

### Step 6: Prepare Next Baton ⚠️ CRITICAL
**必须写入 `next-prompt.md`！**

```markdown
# Evolution Next Step

Session ID: EVOL-<timestamp>
Current Status: <step-name>
Pending Lessons: <count>
Pending Rules: <count>
Next Action: <COLLECT/EXTRACT/VALIDATE/PROPOSE/ACTIVATE/DONE>

Recommended Prompt for Next Session:
"<specific-prompt>"

Example:
"Continue evolution loop. Currently at VALIDATE_LESSONS step. 
Lessons L001 and L002 need validation. Check recent bug fixes 
for similar patterns."
```

**如果不写这个文件 → 循环断开，下次 session 无法继续。**

---

## Completion

当 `defects-found.md` 为空且所有 Lessons 都是 Rules：

```markdown
# Evolution Complete

Session ID: EVOL-<timestamp>
Status: DONE
Lessons Extracted: <count>
Rules Created: <count>
Hooks Activated: <count>

Duration: <sessions-count> sessions
```

---

## Rationalizations — 借口反驳表

| 借口 | 反驳 |
|------|------|
| "This bug is unique" | Unique bugs have unique patterns。提取它。 |
| "I'll remember this" | Memory is unreliable。写入文件。 |
| "One defect is not enough" | One defect starts one lesson。积累会来的。 |
| "The lesson is obvious" | Obvious to you is not obvious to others。记录它。 |
| "I'll create the hook later" | Later never comes。现在写 next-prompt.md。 |
| "I forgot to write the baton" | That breaks the loop。现在写 next-prompt.md。 |

---

## Decision Point

每个 Step 有 Go/No-Go 决策：

| Step | Go Condition | No Action |
|------|--------------|-----------|
| COLLECT | Defects ≥3 | Wait for more |
| EXTRACT | Lessons ≥1 | Back to COLLECT |
| VALIDATE | Any validation +1 | Back to EXTRACT |
| PROPOSE | Validations ≥3 | Back to VALIDATE |
| ACTIVATE | Rules verified | Back to PROPOSE |
| DONE | All Lessons are Rules | Evolution complete |

**时间影响**：
- 每个 No 循环：+1 session
- 总时长：可能跨越数天到数周
```

---

### 4.6 Vibe Templates SKILL.md（模式 2：决策树 + 按需加载）

```yaml
---
name: vibe-templates
description: Access SCALE Engine's 6-phase prompt templates. Use when 
  starting a phase, when user asks for templates, says "give me a PRD",
  "I need a research template", "start the idea phase". Load specific 
  templates via --phase or get full packs via --pack.
type: component
best_for:
  - quick start for phases
  - template-based development
  - vibe-coder workflow
  - developer workflow
scenarios:
  - User says: "Give me a PRD template"
  - User says: "Start the research phase"
  - User says: "I want the quick-prototype pack"
  - User says: "I'm a vibe-coder, help me"
estimated_time: 5 seconds (template loading)
---
```

**正文设计**：

```markdown
# Vibe Templates Registry

## Quick Access

```bash
scale vibe --phase <phase>   # 获取特定阶段模板
scale vibe --pack <pack>     # 获取完整工作流包
scale vibe --user <level>    # 按用户级别定制
```

---

## Phase Decision Tree

### "I have an idea but it's vague"
→ **idea-validate** template

**用户级别适配**：
- vibe-coder：用简单语言描述验证问题
- developer：包含技术可行性分析
- intermediate：平衡

**加载**：`scale vibe --phase idea --user vibe-coder`

---

### "I need to research the domain"
→ **deep-research** template

**用户级别适配**：
- vibe-coder：聚焦用户研究和市场分析
- developer：包含技术调研和架构研究
- intermediate：平衡

**加载**：`scale vibe --phase research`

---

### "I need a PRD"
→ **prd-mvp** template

**用户级别适配**：
- vibe-coder：简化技术规格
- developer：完整技术细节
- intermediate：平衡

**加载**：`scale vibe --phase prd`

---

### "I need a design system"
→ **design-system** template

**加载**：`scale vibe --phase design`

---

### "I need to design agents"
→ **agents-design** template

**加载**：`scale vibe --phase agents`

---

### "I need build instructions"
→ **build-implementation** template

**加载**：`scale vibe --phase build`

---

## Pack Selection Decision Tree

### "I want the complete MVP workflow"
→ **full-mvp** pack

**Phases**: idea → research → prd → design → agents → build
**时间**: 数天到数周
**适合**: 完整产品开发

---

### "I want a quick prototype"
→ **quick-prototype** pack

**Phases**: prd → agents → build
**时间**: 数小时到数天
**适合**: 快速验证想法

---

### "I'm a developer, skip the idea phase"
→ **developer-path** pack

**Phases**: research → prd → design → agents → build
**时间**: 数天
**适合**: 技术团队

---

### "I'm non-technical, give me simple prompts"
→ **vibe-coder-path** pack

**Phases**: idea → prd → agents → build
**时间**: 数天（更长的验证周期）
**适合**: 非技术用户

---

## Product Index

| Phase | Template File | User Levels |
|-------|---------------|-------------|
| idea | `references/idea-validate.md` | vibe-coder, developer, intermediate |
| research | `references/deep-research.md` | developer, intermediate |
| prd | `references/prd-mvp.md` | vibe-coder, developer, intermediate |
| design | `references/design-system.md` | developer, intermediate |
| agents | `references/agents-design.md` | developer |
| build | `references/build-implementation.md` | developer, intermediate |

---

## Progressive Disclosure

主文件（SKILL.md）仅包含决策树。

完整模板存储在 `references/` 目录，LLM 用 Read 工具按需加载：

- idea-validate.md: ~2K tokens
- deep-research.md: ~3K tokens
- prd-mvp.md: ~5K tokens
- design-system.md: ~3K tokens
- agents-design.md: ~4K tokens
- build-implementation.md: ~2K tokens

**总上下文占用**：主文件 + 1-2 个参考文档 ≈ <10K tokens
```

---

## 五、实现路线图

### 5.1 分阶段实施

| 阶段 | 任务 | 预估时间 | 优先级 |
|------|------|----------|--------|
| **Phase 1** | VERIFY + REVIEW Skill（借口反驳表） | 2 小时 | P0 |
| **Phase 2** | SHIP Skill（安全默认值） | 1 小时 | P0 |
| **Phase 3** | DEFINE + PLAN + BUILD Skill | 2 小时 | P1 |
| **Phase 4** | 套件入口 + Vibe Templates | 1 小时 | P1 |
| **Phase 5** | Evolution Skill（接力棒循环） | 3 小时 | P2 |
| **Phase 6** | 测试 + 验证 | 2 小时 | P1 |

**总计**：约 10 小时

### 5.2 文件清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 新建 | `.claude/skills/scale-engine/SKILL.md` | 套件入口 |
| 新建 | `.claude/skills/scale-engine/phases/define/SKILL.md` | DEFINE Phase |
| 新建 | `.claude/skills/scale-engine/phases/plan/SKILL.md` | PLAN Phase |
| 新建 | `.claude/skills/scale-engine/phases/build/SKILL.md` | BUILD Phase |
| 新建 | `.claude/skills/scale-engine/phases/verify/SKILL.md` | VERIFY Phase（借口反驳表） |
| 新建 | `.claude/skills/scale-engine/phases/review/SKILL.md` | REVIEW Phase（思维框架） |
| 新建 | `.claude/skills/scale-engine/phases/ship/SKILL.md` | SHIP Phase（安全默认值） |
| 新建 | `.claude/skills/scale-engine/vibe-templates/SKILL.md` | 模板库 |
| 新建 | `.claude/skills/scale-engine/evolution/SKILL.md` | Evolution |
| 新建 | `.scale/baton/` 目录 | 接力棒状态 |
| 新建 | 各 Skill 的 references/resources/scripts | 参考文档 |

### 5.3 验证标准

每个 Skill 完成后验证：
- [ ] Frontmatter 正确（name, description, type, best_for）
- [ ] Description 包含触发短语和时序位置
- [ ] 有借口反驳表（VERIFY/REVIEW/Evolution）
- [ ] 有量化阈值（VERIFY/REVIEW）
- [ ] 有 Decision Point（所有 Phase）
- [ ] 有 Completion Checklist
- [ ] Token 预算 <5K
- [ ] LLM 能通过 description 自动识别加载

---

## 六、风险与降级方案

### 6.1 风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| LLM 不加载 Skill | 遵从率下降 | Description 优化 + 触发短语 |
| Token 超预算 | 上下文溢出 | Progressive disclosure |
| 借口反驳表太长 | LLM 跳过 | 精简到最关键的 12 条 |
| 接力棒文件损坏 | Evolution 断裂 | 文件校验 + 自动恢复 |

### 6.2 降级方案

如果 Skill 体系不工作：
- 保留现有 CLI 命令作为 fallback
- Phase Commands 继续通过 FSM 状态流转
- 借口反驳表可简化为 CLI 输出的警告信息

---

## 七、预期收益

### 7.1 量化收益

| 指标 | 当前 | 目标 | 提升 |
|------|------|------|------|
| LLM 遵从率（VERIFY） | ~60% | ~90% | +30% |
| LLM 遵从率（REVIEW） | ~50% | ~85% | +35% |
| 验证漏检率 | ~20% | ~5% | -15% |
| Evolution 持久化 | 无 | 有 | 新增能力 |
| 跨 session 连续性 | 无 | 有 | 新增能力 |

### 7.2 质量收益

1. **堵死偷懒路径**：借口反驳表强制 LLM 达到验证标准
2. **思维框架**：控制 REVIEW Phase 的分析深度
3. **安全默认值**：SHIP Phase 不会做出危险操作
4. **跨 session 持久化**：Evolution 能跨越数天到数周持续学习
5. **决策树导航**：用户快速选择正确的 Phase/Pack

---

## 八、附录：文章模式对照表

| 文章模式 | SCALE Skill | 行数预估 | 关键技术 |
|----------|-------------|----------|----------|
| 模式 1：线性流程 | SHIP | ~150 行 | 安全默认值、负面指令、降级方案 |
| 模式 2：决策树 | Vibe Templates | ~100 行 | 用户意图分类、渐进式披露 |
| 模式 3：循环迭代 | VERIFY | ~300 行 | 借口反驳表（12 条）、量化阈值 |
| 思维框架 | REVIEW | ~250 行 | Karpathy Principles、量化阈值 |
| 模式 4：接力棒循环 | Evolution | ~200 行 | next-prompt.md、文件协议 |
| 模式 5：多阶段 | 套件入口 | ~100 行 | Phase Decision Tree、时间预估 |

---

## 九、审核要点

请审核以下关键决策：

### A. Skill 目录位置
- **建议**：`.claude/skills/scale-engine/`
- **原因**：符合标准，易于管理

**问题**：是否同意此目录结构？

### B. Phase Commands 保留方式
- **建议**：CLI 命令保留作为 fallback，Skill 作为推荐入口
- **原因**：双轨并行，降低风险

**问题**：是否同意双轨并行？

### C. 借口反驳表长度
- **建议**：VERIFY 12 条，REVIEW 6 条，Evolution 6 条
- **原因**：参考文章示例，过多会跳过

**问题**：是否同意此长度？

### D. 量化阈值选择
- **建议**：
  - Coverage ≥80%（已有）
  - 每个 feature ≥1 acceptance test
  - 每个改动 ≥3 假设
  - CRITICAL findings = 0
- **原因**：参考文章示例

**问题**：是否同意此阈值？

### E. 接力棒文件协议
- **建议**：`.scale/baton/` 目录，6 个文件
- **原因**：参考 Google Labs stitch-loop

**问题**：是否同意此协议？

### F. 实施优先级
- **建议**：P0=VERIFY+REVIEW+SHIP，P1=其他 Phase，P2=Evolution
- **原因**：质量门控最关键

**问题**：是否同意此优先级？

---

**请审核以上方案，提出修改建议。**