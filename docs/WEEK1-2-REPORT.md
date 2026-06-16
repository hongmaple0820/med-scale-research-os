# W1-2 交付报告

> 日期: 2026-04-21 | 状态: ✅ 全部完成

---

## 交付物清单

### 核心代码

| 文件 | 说明 | 状态 |
|------|------|------|
| `src/artifact/types.ts` | 11 种 Artifact 类型 + Event + FSM 类型定义 | ✅ |
| `src/artifact/fsm.ts` | 状态机引擎 (register/transition/canTransition/availableActions) | ✅ |
| `src/artifact/fsmDefinitions.ts` | 11 种 Artifact 的完整 FSM 定义 (含 guards) | ✅ |
| `src/artifact/store.ts` | InMemoryArtifactStore (CRUD + JSON 持久化) | ✅ |
| `src/core/eventBus.ts` | EventBus (pub/sub + JSONL 持久化 + replay + query + middleware) | ✅ |
| `src/core/logger.ts` | Pino logger 封装 | ✅ |
| `src/core/container.ts` | DI 容器 | ✅ |
| `src/guardrails/detectors.ts` | 5 种反惰性检测器 | ✅ |

### 测试

| 文件 | 用例数 | 通过 |
|------|--------|------|
| `tests/core/eventBus.test.ts` | 14 | ✅ 14/14 |
| `tests/artifact/fsm.test.ts` | 18 | ✅ 18/18 |
| **合计** | **32** | **32/32** |

### Demo

| 文件 | 演示内容 | 状态 |
|------|----------|------|
| `examples/event-demo.ts` | EventBus 创建/订阅/持久化/重放/查询 | ✅ 跑通 |
| `examples/fsm-demo.ts` | Spec 全生命周期 + Guard 拦截 + Plan 联动 | ✅ 跑通 |

---

## 验证结果

```
# TypeScript 类型检查
$ npx tsc --noEmit    → exit 0 (零错误)

# 单元测试
$ npx vitest run      → 32 passed, 0 failed

# Demo 1: EventBus
$ npx tsx examples/event-demo.ts
  → 3 events emitted, 3 persisted, 3 replayed ✅

# Demo 2: FSM
$ npx tsx examples/fsm-demo.ts
  → Spec: DRAFT→REVIEWING→(guard block)→FROZEN→REVISING ✅
  → Plan: DRAFT→APPROVED ✅
  → Guard 拦截 ambiguityScore > 0.2 ✅
  → 8 events captured in event stream ✅
```

---

## 关键设计决策落地

1. **FSM 硬约束生效** — Spec 的 `ambiguityScore > 0.2` 被 guard 物理拦截，AI 无法绕过
2. **事件溯源生效** — 每次状态变化都落盘 JSONL，可重放重建
3. **Artifact 不可变** — 所有 event 对象 `Object.freeze()`，handler 异常不影响后续分发
4. **11 种 FSM 全定义** — Need/Insight/Spec/Plan/TestPlan/Task/Change/Evidence/Defect/Lesson/Release

---

## W3 计划

| 任务 | 说明 |
|------|------|
| SQLite 持久化 | 替换 InMemoryStore → SQLite + better-sqlite3 |
| Drizzle schema | 从 types.ts 生成 Drizzle ORM schema |
| 迁移脚本 | 初始化 DB 的 migration |
| JSONL → SQLite 同步 | 事件流写入 SQLite events 表 |
| 测试 | Store CRUD + 查询 + 持久化恢复 |

---

## W3 交付报告 (2026-04-21)

> 状态: ✅ 全部完成

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/artifact/sqliteStore.ts` | SQLite 持久化 Store（WAL 模式、边表、事件表、prepared statements） |
| `tests/artifact/sqliteStore.test.ts` | 14 个测试用例 |

### 测试结果

```
Test Files  3 passed (3)
     Tests  46 passed (46)   ← W1-2 的 32 + W3 新增 14
```

### W3 交付验证点

1. **SQLite WAL 模式** — 读写并发安全 ✅
2. **Schema DDL** — artifacts/events/artifact_edges/meta 4 张表 ✅
3. **CRUD 全通** — create/get/update/delete + 版本自增 ✅
4. **Parent-child 边表** — artifact_edges 独立表，双向查询 ✅
5. **Query 过滤** — type/status/tags/parentId/limit 全支持 ✅
6. **Gate 管理** — add + update gate（同名覆盖） ✅
7. **事件自动入库** — EventBus `*` 订阅 → events 表 ✅
8. **数据恢复** — close + reopen 数据不丢失 ✅
9. **FSM 集成** — SQLiteStore + FSM transition 联动正常 ✅
10. **Guard 拦截持久化** — 被 guard 拦截后 SQLite 状态不变 ✅
