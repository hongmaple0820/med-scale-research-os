# ADR-0002：采用不可变原始层与三层数据血缘

## Status

Accepted

## Context

仅保存 API 摘要或最终图表无法验证真实性，也无法在解析器、方法或规则变化后重建结果。

## Decision

数据分为 raw、normalized、analysis 三层。raw 层不可变；每个产物记录 SHA-256、稳定
记录 ID、许可、来源、父产物、程序和方法版本。下游只引用已批准的上游产物。

## Consequences

### Positive

- 任意结果可回溯到真实文件。
- 方法更新后可以重建而不覆盖历史。
- 支持授权数据隔离和公开交付过滤。

### Negative

- 存储占用增加。
- 需要垃圾回收、快照和备份策略。

## Alternatives Considered

- 只保留最终结果：不可审计。
- 原始与结果两层：缺少标准化方法和 QC 的独立审查边界。
- 立即建设大型 Lakehouse：V1 复杂度过高。
