# SCALE Engine 迁移文档 / Migration Docs

本目录收录按版本区间组织的破坏性变更与迁移路径。完整、权威的迁移指南见
[`docs/guides/MIGRATION.md`](../guides/MIGRATION.md)。

## 版本专项 / Version-specific

| 区间 | 文档 | 说明 |
|---|---|---|
| 0.38 → 0.43 | [v0.38-to-v0.43.md](./v0.38-to-v0.43.md) | 三引擎架构 + 门禁扩展 (G0-G22) |

## 通用迁移步骤 / General steps

```bash
cp -r .scale .scale.backup
npm install -g @hongmaple0820/scale-engine@latest
scale upgrade check --dir .
scale upgrade plan --dir .
scale upgrade diff --dir .      # 查看受管文件本地改动 vs 模板
scale upgrade apply --dir . --confirm
scale verify --dir .
scale upgrade rollback --dir .  # 如需回滚
```
