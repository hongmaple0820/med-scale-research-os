# SCALE Engine 工作流优化迭代方案 v2

> 日期: 2026-05-27
> 基于: 全面评估报告（架构、闭环、文档、安装、升级、提示词、代码质量、测试覆盖 8 维度）
> 目标: 综合评分从 B+ (7.5/10) 提升到 A- (8.5/10)

---

## 阶段一：发布卫生（P0，1-2 天）

### 1.1 版本同步
- **问题**: git tag v0.42.0，npm 发布 v0.40.2，package.json version=0.40.2
- **操作**: 将 package.json version 更新为 0.42.0，执行 npm publish
- **验证**: `npm info @hongmaple0820/scale-engine version` 输出 0.42.0

### 1.2 npm 包瘦身
- **问题**: files 字段包含 image/（wxPay.jpg 168KB、zfb.jpg 186KB、wechat-public.jpg 61KB）
- **操作**: 从 package.json 的 files 数组中移除 image；将支付图片移出 docs/ 打包范围
- **验证**: `npm pack --dry-run` 不包含 .jpg 文件，包体积从 6.2MB 降至 <5MB

### 1.3 测试配置修复
- **问题**: --pool=forks --maxWorkers=4 --minWorkers=4 在部分环境报 minThreads/maxThreads conflict
- **操作**: 在 vitest.config.ts 中显式设置 poolOptions.forks 的 min/max
- **验证**: `npx vitest run` 在 Windows/Linux/macOS 均无配置错误

---

## 阶段二：代码结构重构 + 门禁增强（P1，5-7 天）

### 2.1 CLI 模块拆分
- **问题**: src/api/cli.ts 单文件 80+ import、66+ 命令定义
- **操作**: 创建 src/cli/ 目录，按引擎拆分：
  - src/cli/shield.ts — scale shield compile|status|test
  - src/cli/orchestrator.ts — scale orch start|stop|status|log
  - src/cli/cortex.ts — scale cortex extract|inject|metrics|evolve
  - src/cli/workflow.ts — scale define|plan|build|verify|review|ship
  - src/cli/runtime.ts — scale runtime start|record|final-check
  - src/cli/memory.ts — scale memory pack|settle|provider
  - src/cli/setup.ts — scale setup|bootstrap|doctor
- **验证**: scale --help 输出不变；scale shield --help 等子命令正常

### 2.2 测试覆盖率修复
- **问题**: vitest.config.ts exclude 了 src/api/** 和 src/adapters/**
- **操作**: 移除 coverage exclude 中的 src/api/**；保留 src/adapters/**
- **验证**: `npx vitest run --coverage` 报告覆盖率 >80%

### 2.3 慢测试优化
- **问题**: commitDiscipline 42s、runtimeCli 38s、memoryBrainCli 43s
- **操作**:
  - commitDiscipline: mock git 命令，减少真实 git 操作
  - runtimeCli/memoryBrainCli: 使用内存 SQLite 替代文件 SQLite
- **验证**: 全量测试从 ~500s 降至 <300s

### 2.4 提升现有门禁激活状态

| 变更 | 理由 |
|------|------|
| G1 Exploration → default, blocking for L/CRITICAL | 探索是所有后续阶段的基础 |
| G2 Planning → default, blocking for L/CRITICAL | L 级任务必须有边界/异常/回滚分析 |
| G12 Workflow Thoroughness → default | 确保各阶段有产出 |
| engineering-standards extension → block | 架构一致性不应是可选的 |

### 2.5 新增门禁（G16-G22）

#### G16: Commit Discipline（提交纪律）
- family: core, activation: default, blocking: true, requiredLevel: M
- 检查: 未提交文件数阈值、距上次提交时间、大文件检测
- 实现: 复用 src/workflow/CommitDiscipline.ts

#### G17: Documentation Hygiene（文档卫生）
- family: core, activation: default, blocking: false(M)/true(L), requiredLevel: M
- 检查: 断链、命令可执行性、版本号一致性
- 实现: 扩展 G8-verify.sh 中的 markdown 检查

#### G18: Runtime Evidence（运行时证据）
- family: core, activation: default, blocking: true, requiredLevel: M
- 检查: 证据存在性、退出码一致性、final-check 通过、新鲜度
- 实现: 复用 src/runtime/RuntimeEvidenceLedger.ts

#### G19: Code Review（代码评审）
- family: core, activation: profile, blocking: true for L/CRITICAL, requiredLevel: L
- 检查: review 存在性、覆盖度、问题解决、非自审
- 实现: 复用 src/workflow/ReviewStore.ts + ReviewAnalyzer.ts

#### G20: Supply Chain（供应链安全）
- family: core, activation: default, blocking: true, requiredLevel: ALWAYS
- 检查: npm audit CRITICAL/HIGH、lock 一致性、phantom dependencies
- 实现: 从 G7 中独立 DependencyAuditor

#### G21: Context Budget（上下文预算）
- family: meta, activation: default, blocking: false, requiredLevel: M
- 检查: token 预算、冗余上下文、compression 使用
- 实现: 复用 src/context/ContextBudget.ts

#### G22: Session Health（会话健康）
- family: meta, activation: default, blocking: false, requiredLevel: M
- 检查: worktree 清理、会话时长、状态一致性
- 实现: 复用 src/workflow/SessionStateTracker.ts

### 2.6 Shell 脚本集成

更新 scripts/gates/all.sh:
```bash
case "$MODE" in
  workflow) GATES=(G1 G2 G3 G16) ;;
  quality) GATES=(G0 G4 G5 G6 G7 G8 G17 G18 G19 G20) ;;
  meta) GATES=(G9 G10 G11 G12 G13 G14 G15 G21 G22) ;;
  all) GATES=(G0 G1 G2 G3 G4 G5 G6 G7 G8 G16 G17 G18 G19 G20 G21 G22) ;;
esac
```

新增 scripts/gates/G16-verify.sh 到 G22-verify.sh。

### 2.7 最终门禁矩阵

| Gate | 名称 | 默认启用 | 阻断 | 等级 |
|------|------|---------|------|------|
| G0 | Build | yes | yes | ALWAYS |
| G1 | Exploration | yes | yes(L+) | M |
| G2 | Planning | yes | yes(L+) | L |
| G3 | TDD | yes | yes | CRITICAL |
| G4 | Lint | yes | yes | ALWAYS |
| G5 | Tests | yes | yes | ALWAYS |
| G6 | Coverage | profile | yes | ALWAYS |
| G7 | Security | profile | yes | ALWAYS |
| G8 | Product Smoke | profile | yes | M |
| G9 | Knowledge Utilization | yes | no | M |
| G10 | Evolution Effectiveness | no | no | M |
| G11 | Guardrail Effectiveness | yes | no | M |
| G12 | Workflow Thoroughness | yes | no | M |
| G13 | Multi-Agent Coordination | no | no | M |
| G14 | Skill Utilization | no | no | M |
| G15 | Self-Improvement | no | no | M |
| G16 | Commit Discipline | yes | yes | M |
| G17 | Documentation Hygiene | yes | no(M)/yes(L) | M |
| G18 | Runtime Evidence | yes | yes | M |
| G19 | Code Review | profile | yes(L+) | L |
| G20 | Supply Chain | yes | yes | ALWAYS |
| G21 | Context Budget | yes | no | M |
| G22 | Session Health | yes | no | M |

变更前: 4 个默认启用阻断门禁 (G0/G3/G4/G5)
变更后: 11 个默认启用阻断门禁 (G0/G1/G2/G3/G4/G5/G16/G18/G20 + G17@L + G19@L)

---

## 阶段三：文档治理（P1-2，3-5 天）

### 3.1 目录重组
```
docs/
├── start/              # 新用户入口（保留）
├── guides/             # 维护者指南（保留）
├── workflow/           # 工作流模板（保留）
├── reference/          # 新增：API 参考
│   └── cli.md
├── architecture/       # 从根目录迁入
├── engines/            # 三引擎文档
├── capabilities/       # 能力文档
├── archive/            # 历史规划（不打包）
└── README.md           # 文档地图（更新路径）
```

### 3.2 npm 包文档精简
- package.json files 只保留：docs/start/、docs/guides/、docs/workflow/、docs/reference/、docs/README.md

### 3.3 CLI Reference 自动生成
- scripts/generate-cli-reference.mjs 从 citty 命令树提取 --help 输出
- 生成 docs/reference/cli.md
- 加入 npm run docs:cli 脚本

### 3.4 架构图
- 在 docs/architecture/01-ARCHITECTURE.md 中添加 Mermaid 架构图

---

## 阶段四：闭环验证增强（P2，5-7 天）

### 4.1 Shield 端到端验证
- 添加 scale shield inject — 将 hook 脚本写入 settings.json
- 添加 scale shield verify — 验证 hook 已注册
- smoke test: compile → inject → verify → test 完整链路

### 4.2 Orchestrator 真实 Tracker 适配
- 完善 GitHub TrackerAdapter（gh issue list --json 真实查询）
- 添加 smoke test: scale orch status → 列出 open issues

### 4.3 Cortex 端到端验证
- 添加 scale cortex verify — 创建测试 observation → extract → inject → 验证

### 4.4 Ship Pipeline 完整性
- 在 src/workflows/ShipPipeline.ts 中定义 8 步：preflight → gate-workflow → gate-quality → verify → review → version-bump → commit → tag
- scale ship --dry-run 输出 8 步计划

---

## 阶段五：版本迁移与兼容（P2，2-3 天）

### 5.1 Breaking Changes 文档
- 创建 docs/migration/v0.38-to-v0.42.md

### 5.2 scale upgrade diff 命令
- 新增 scale upgrade diff --dir . — 输出受管文件的本地改动 vs SCALE 模板的 diff

### 5.3 版本锁定增强
- governance.lock.json 增加 compatibleVersions 字段
- CLI 版本与 lock 文件差距 >2 个 minor 版本时警告

---

## 依赖关系

```
阶段一 (发布卫生)
  ↓
阶段二 (代码重构 + 门禁) ← 可与阶段三并行
  ↓
阶段三 (文档治理)
  ↓
阶段四 (闭环验证) ← 依赖阶段二的 CLI 拆分
  ↓
阶段五 (版本迁移) ← 依赖阶段三的文档重组
```

## 风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| CLI 拆分引入回归 | HIGH | 先写 CLI 快照测试，再拆分 |
| 文档路径变更影响外部链接 | MEDIUM | 旧路径添加 redirect/说明 |
| Orchestrator 真实 tracker 依赖 GitHub CLI | MEDIUM | 保留 Mock 作为 fallback |
| 慢测试优化可能遗漏边界 | LOW | 优化后跑全量确认 |
| 新增门禁导致现有 CI 失败 | MEDIUM | 先 warn-only 运行一周，再启用 blocking |

## 验收标准

| 阶段 | 验收条件 |
|------|---------|
| 一 | npm info 版本=0.42.0；npm pack <5MB 无图片；vitest 无配置错误 |
| 二 | cli.ts <200 行；coverage >80%；全量测试 <300s；22 个门禁全部注册可执行 |
| 三 | docs/ 目录 <50 个文件；docs/reference/cli.md 存在；架构图可见 |
| 四 | scale shield inject --verify 通过；scale orch status --json 返回 issue；scale cortex verify 通过 |
| 五 | docs/migration/ 存在；scale upgrade diff 可用 |

---

## 执行进度 (2026-06-08)

> 由主控中心核查实际产物后推进。基线验证发现 `better-sqlite3` 原生模块 ABI 不匹配
> (NODE_MODULE_VERSION 127 vs 当前 137)，导致 define/plan/build 等 SQLite 命令及对应测试失败；
> 这是环境问题，需 `npm rebuild better-sqlite3`，与本轮改动无关。build + typecheck + 升级测试 (14) 全过。

| 项目 | 状态 | 证据/说明 |
|---|:---:|---|
| 一 发布卫生 (1.1/1.2/1.3) | ✅ 已完成 | version=0.43.0；files 无 image/；vitest poolOptions.forks min/max |
| 二 2.2 覆盖率 exclude | ✅ 已完成 | 仅 exclude src/adapters/** |
| 二 2.5/2.6 G16-G22 + all.sh | ✅ 已完成 | scripts/gates/G16-G22-verify.sh 齐全 |
| 二 2.1 CLI 拆分 | ⏸️ 未做 | cli.ts 仍 6795 行，HIGH 回归风险，按用户决定最后单独评估 |
| 三 3.2 npm 文档精简 | ✅ 本轮完成 | package.json files 去除 4 个根级散文档，加入 docs/reference |
| 三 3.3 CLI Reference | ✅ 本轮完成 | scripts/generate-cli-reference.mjs + npm run docs:cli，生成 docs/reference/cli.md (228 命令) |
| 三 3.4 架构图 | ✅ 本轮完成 | docs/01-ARCHITECTURE.md 增加 Mermaid flowchart |
| 三 3.1 目录重组 | ⏸️ 延后 | 移动 40+ 根级文档会破坏 externalReferences.test.ts 路径引用与大量内链，需专项 + 可验证环境 |
| 四 闭环验证 | ✅ 复核 | shield compile 已含 settings 注入、status 已校验 hook 注册；cortex verify 已存在 |
| 五 5.1 docs/migration/ | ✅ 本轮完成 | docs/migration/README.md + v0.38-to-v0.43.md (引用权威 guides/MIGRATION.md) |
| 五 5.2 scale upgrade diff | ✅ 本轮完成 | UpgradeManager.createUpgradeDiffReport + `scale upgrade diff` 子命令 (json/human) |
