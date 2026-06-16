# Runtime Evidence

Runtime Evidence 是 SCALE 用来记录 Agent 实际做过什么的运行时证据层。它的目标很直接：没有真实命令、工具、浏览器、skill 或人工验证证据时，Agent 不能声称任务已经完成。

它和现有证据层的关系：

- Gate evidence：回答 build、lint、test、security、review 等门禁是否通过。
- Tool evidence：回答必需的 skill、MCP、浏览器、桌面自动化或 CLI 工具是否执行过。
- Runtime evidence：回答当前会话是否具备可信的最终交付证据。

## 存储位置

Runtime 数据写入 SCALE 已忽略的本地运行时目录：

```text
.scale/
├── events/
│   ├── current-session.json
│   └── sessions/<session-id>.jsonl
└── evidence/
    └── runtime/<evidence-id>.json
```

这些文件默认是本地运行时产物，不应该提交到 Git。需要长期保留时，应把摘要沉淀到任务 summary、ADR、README 或模块文档中，而不是直接提交原始日志。

## 基本流程

启动会话：

```bash
scale runtime start \
  --session-id 2026-05-18-runtime-evidence \
  --task-id 2026-05-18-runtime-evidence \
  --level M \
  --agent codex
```

在真实命令、门禁、浏览器验证、skill 执行、MCP 调用或人工检查之后记录证据：

```bash
scale runtime record \
  --title "build" \
  --kind command \
  --status passed \
  --command "npm run build" \
  --exit-code 0 \
  --summary "TypeScript build passed"
```

检查是否允许最终交付：

```bash
scale runtime final-check \
  --task-id 2026-05-18-runtime-evidence \
  --session-id 2026-05-18-runtime-evidence \
  --level M
```

检查运行时健康状态：

```bash
scale runtime doctor --level M
scale doctor
```

## 完成规则

M、L、CRITICAL 任务在最终交付前必须满足：

- 当前 task/session 范围内至少有一条 `passed` runtime evidence。
- 当前 task/session 范围内不能存在 `failed` runtime evidence。

S 级任务可以保持轻量，但一旦存在失败证据，仍然不能声称完成。

## 脱敏规则

Runtime evidence 复用 tool evidence 的脱敏模型。写入 JSON 前会处理命令、摘要、artifact 路径和 metadata 中的敏感字段：

- password
- token
- secret
- authorization
- cookie
- credential
- api key
- private key

这样可以保留有用证据，同时避免把 token、cookie、密钥等内容写进运行时文件。

## 推荐使用场景

适合记录 runtime evidence 的场景：

- 最终交付检查。
- 长会话或多阶段任务。
- 跨 Agent 或外部 CLI review。
- 浏览器、桌面自动化、MCP、skill 验证。
- 发版前 preflight。
- 需要进入后续学习闭环的失败、修复和重试记录。

不要用 runtime evidence 替代长期维护文档。Runtime evidence 是“操作证明”，PRD、ADR、架构文档、README、模块文档才是长期项目契约。
