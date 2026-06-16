# Agent Governance Demo

这是 SCALE Engine 的最小官方 demo 项目，用一个 OAuth state 校验场景展示 Agent 工程治理如何落到真实代码、测试、证据和报告里。

业务目标很小：OAuth callback 必须拒绝缺失、过期、已消费或不匹配的 state。

治理目标更重要：Agent 不能只说“我完成了”，必须留下可验证证据。

## 快速运行

```bash
npm install
npm test
```

## 一键治理烟测

```bash
npm run workflow:smoke
```

这个命令会依次运行：

- `npm test`：验证业务行为。
- `scale eval run --dir .`：运行工作流基线评测。
- `scale context budget --dir .`：检查上下文预算，避免无节制读取。
- `scale artifact dashboard --dir . --lang zh`：生成本地治理 HTML 看板。

## 适合演示的 SCALE 命令

```bash
scale governance mode --task "修复 OAuth state 校验绕过问题" --files "src/oauth-state.ts,tests/oauth-state.test.ts"
scale skill radar --dir . --task "修复 OAuth state 校验绕过问题" --phase verify --level M --files "src/oauth-state.ts,tests/oauth-state.test.ts"
scale codegraph status --dir .
scale eval run --dir .
scale artifact dashboard --dir . --lang zh
```

## 观察点

- `src/oauth-state.ts` 保持很小，便于核对 Agent 是否过度设计。
- `tests/oauth-state.test.ts` 覆盖成功、缺失、过期、已消费和不匹配 state。
- `CONTEXT.md` 和 `docs/CONTEXT-MAP.md` 只提供必要上下文，避免 demo 自己变成 token 污染源。
- `.scale/evals/suites/workflow-baseline.json` 可由 `scale eval init --dir .` 重新生成。

## 这不是业务模板

这个 demo 不是 OAuth 产品模板，而是治理闭环模板。真实项目接入时，应保留 SCALE 的证据、评测、上下文预算和看板机制，再替换成自己的业务代码、服务矩阵和验证脚本。
