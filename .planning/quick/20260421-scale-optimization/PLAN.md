# SCALE Engine 工作流优化实施计划

## 目标
让 SCALE Engine 真正约束 Agent 行为，降低操作成本，提升可用性。

## 任务列表

### T1: scale init - 配置 hooks（P0）
- 在 maple-cart-mall 项目运行 `scale init --agent claude-code`
- 验证 .claude/settings.json 包含 scale gate hooks
- 创建 demo artifacts（测试 hooks 拦截）

### T2: 实现 context status 命令（P0）
- ContextBuilder 新增 getStatus() 方法
- CLI 新增 `scale context status --session-id <id>` 命令
- 输出：role, allowedTools, deniedTools, activeArtifacts, constraints

### T3: 增强 suggest 命令（P1）
- suggest 支持显示 session-level constraints（可选参数 `--session-id`）
- 输出当前 role 允许的工具列表
- 输出 Gateway 禁止的命令列表

### T4: 实现 create-prd 命令（P1）
- CLI 新增 `scale create-prd <title> --specs <desc> --plans <desc> --tasks <list>` 命令
- 自动创建 Spec → Plan → Tasks 层级
- 批量创建 Tasks（逗号分隔）
- 输出创建的 artifact IDs

### T5: 构建测试发布（P0）
- npm run build
- 本地测试新增命令
- 更新 CHANGELOG
- npm publish v0.3.0

## 验收标准
- hooks 配置正确
- context status 输出清晰
- create-prd 自动生成层级
- 新版本发布成功

