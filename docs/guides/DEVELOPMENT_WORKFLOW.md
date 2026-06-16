# SCALE Engine 开发工作流

这份文档说明日常如何在 `scale-engine` 仓库里按最新工程化工作流工作。

## 标准闭环

```text
探索 -> 规划 -> 执行 -> 验证 -> 沉淀
```

## 1. 探索

目标：先弄清真实仓库状态，再动手。

```bash
make new-task NAME=task-slug LEVEL=M
make plan NAME=task-slug LEVEL=M
make explore FILES='AGENTS.md CLAUDE.md README.md package.json src/api/cli.ts' MSG='main contradiction'
make gate-workflow
```

最低要求：

- 至少读 3 个相关文件。
- 写清主矛盾，而不是只列文件名。
- 对不确定项明确标出，不靠猜。

## 2. 规划

在 `.planning/tasks/<task>/plan.md` 里至少补齐这些信息：

- scope / boundary
- acceptance criteria
- exception / failure path
- rollback / fallback
- verification commands

如果任务改动发布、权限、安全、凭据、npm 发版或破坏性行为，按 `CRITICAL` 处理。

## 3. 执行

原则：

- 最小必要修改。
- 优先复用现有脚本和 `npm` 命令，不再发明第二套命令。
- 改 `src/` 行为时，原则上同步改 `tests/`，否则会被 G3 拦下。

## 4. 验证

推荐顺序：

```bash
make gate-workflow     # G1, G2, G3, G16
make gate-quality      # G0, G4, G5, G6, G7, G8, G17, G18, G19, G20
make verify PROFILE=default  # 完整验证
git diff --check
```

门禁分三层（共 23 个），详见 [GATES_AND_SCORE.md](../workflow/GATES_AND_SCORE.md)：

**核心门禁（G0-G8）** — 每次提交必须通过：
- `G0` 构建必须通过
- `G1` 探索至少读 3 个文件并记录主矛盾
- `G2` 计划包含边界、异常、回滚
- `G3` `src/` 行为改动必须伴随测试
- `G4` lint 必须通过
- `G5` 测试必须通过
- `G6` 覆盖率和任务证据（profile 级）
- `G7` 安全和依赖检查（profile 级）
- `G8` 产品冒烟（profile 级）

**元治理门禁（G9-G15）** — 治理有效性检查：
- `G9` 知识库使用、`G11` 护栏有效性、`G12` 工作流完整性（默认启用）
- `G10` 改进证据、`G13` 多 Agent 协调、`G14` skill 使用、`G15` 自我改进（可选）

**增强门禁（G16-G22）** — 提交纪律和运行时质量：
- `G16` 未提交文件阈值和大文件检查（阻断）
- `G17` 文档链接卫生（advisory）
- `G18` 运行时证据记录（阻断）
- `G19` 代码审查（L/CRITICAL 任务阻断）
- `G20` 供应链安全（阻断）
- `G21` 上下文 token 预算（advisory）
- `G22` 会话健康：worktree 泄露检查（advisory）

## 5. 沉淀

应该留下：

- `verification.md`
- `review.md`
- `summary.md`
- 必要的长期规则文档更新

不应该留下：

- 临时日志
- worktree 状态
- 截图、trace、缓存
- 只对一次任务有意义的中间文件
