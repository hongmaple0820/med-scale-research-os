<!--
  Version: 1.0
  Last Updated: 2026-05-19
  Scope: 文档编写与维护规范
  Maintainer: SCALE Engine Team
-->
# 文档规范 (Document Standards)

SCALE Engine 自身文档必须遵守本规范。作为治理引擎，"以身作则"是基本要求。

## 1. 文档分层

| 层级 | 目录 | 内容 | 示例 |
|------|------|------|------|
| 入门 | `docs/start/` | 新用户路径、quickstart、demo | quickstart.md |
| 治理能力 | `docs/` | 当前产品能力说明 | RESOURCE_GOVERNANCE.md |
| 架构参考 | `docs/` (数字前缀) | 系统设计、数据模型、决策 | 00-OVERVIEW.md, 06-DECISIONS.md |
| 历史规划 | `docs/plans/` | 过程记录、已废弃方案 | plans/*.md |
| 推广 | `docs/` (promote-*) | 对外宣传素材 | promote-article-v2.md |
| 测试指南 | `tests/e2e/` | 产品功能测试 | PRODUCT_TEST_GUIDE.md |
| 贡献指南 | 项目根目录 | 开发环境、流程 | CONTRIBUTING.md |
| GitHub 模板 | `.github/` | Issue/PR 模板 | ISSUE_TEMPLATE/*.md |

## 2. 文档头部

所有 `.md` 文件必须包含版本信息头部：

```markdown
<!--
  Version: 1.0
  Last Updated: 2026-05-19
  Scope: 本文档覆盖的范围
  Maintainer: 负责人或团队
-->
```

## 3. 入口索引

创建或修改文档后，必须更新对应索引：

| 文档位置 | 需更新的索引 |
|----------|-------------|
| `docs/*.md` | `docs/README.md` |
| `docs/start/*.md` | `docs/start/README.md` |
| `tests/e2e/*.md` | `tests/e2e/README.md` |
| 项目根目录 | `README.md` |

## 4. 模块影响说明

文档变更时，在提交信息或文档末尾说明影响的模块：

```markdown
## 模块影响

- `src/config/profiles.ts` — 新增配置 profile 系统
- `src/api/cli.ts` — init 命令集成 profile
- `src/api/doctor.ts` — 新增 config health 检查
```

## 5. 代码块标注

所有代码块必须标注语言：

````markdown
```typescript
const x = 1
```

```bash
scale init
```
````

## 6. 链接规范

- 使用相对路径：`[架构](01-ARCHITECTURE.md)` 而非绝对 URL
- 禁止硬编码 `localhost` 链接
- 外部链接标注来源：`[Node.js](https://nodejs.org) (external)`

## 7. 命名规范

| 类型 | 格式 | 示例 |
|------|------|------|
| 架构文档 | `NN-TITLE.md` | `00-OVERVIEW.md` |
| 治理能力 | `UPPER_SNAKE.md` | `RESOURCE_GOVERNANCE.md` |
| 入门教程 | `kebab-case.md` | `artifact-lifecycle.md` |
| 计划文档 | `date-title.md` | `2026-05-19-plan.md` |

## 8. 门禁检查

文档变更由 `scripts/gates/G8-verify.sh` 自动检查：

- [ ] 版本头存在
- [ ] 文件位置符合分层规则
- [ ] 无硬编码密钥
- [ ] 无 localhost 链接
- [ ] 代码块标注语言
