# MedSCALE Research OS 快速开始

MedSCALE Research OS 是面向医学研究 Agent 工作流的本地操作系统。它把医学研究执行、质量门禁、事实核查、交付包审计、记忆播种和 Memory Brain 审核放进一个可复核的研究者视图。

> 本项目不提供临床建议。所有医学结论都需要专家人工复核。

## 30 秒本地启动

```bash
npm install
npm run build
npm run medscale -- doctor --json
npm run medscale -- setup --lang zh
npm run medscale -- setup --visual --lang zh
npm run medscale -- dashboard
```

打开：

```text
http://127.0.0.1:18766
```

## 构建后入口

```bash
node dist/api/medscale.js doctor --json
node dist/api/medscale.js setup --lang zh
node dist/api/medscale.js setup --visual --lang zh
node dist/api/medscale.js os-plan --json
node dist/api/medscale.js dashboard
```

未来发布到 npm 后，目标入口是：

```bash
npx -y @hongmaple0820/med-scale-research-os setup --lang zh
npx -y @hongmaple0820/med-scale-research-os setup --visual --lang zh
npx -y @hongmaple0820/med-scale-research-os doctor --json
npx -y @hongmaple0820/med-scale-research-os dashboard
```

## 常用命令

```bash
npm run medscale -- doctor --json
npm run medscale -- setup --lang zh
npm run medscale -- setup --visual --lang zh
npm run medscale -- setup --lang en
npm run medscale -- os-plan --json
npm run medscale -- token report --json
npm run medscale -- dashboard
```

Memory Brain learning candidate 审核：

```bash
npm run medscale -- memory-review approve --candidate-id <id> --json
npm run medscale -- memory-review reject --candidate-id <id> --json
npm run medscale -- memory-review stale --candidate-id <id> --json
npm run medscale -- memory-review restore --candidate-id <id> --json
```

Token / cost 账本：

```bash
npm run medscale -- token record --provider anthropic --medical-lane literature --usage-file usage.json --json
npm run medscale -- token ingest --target CDK4 --disease "breast cancer" --json
npm run medscale -- token ingest --file artifact-usage.json --provider anthropic --json
npm run medscale -- token report --json
```

Agent 或外部模型写入 `agent_reviews.json` 时，建议同步写入 `medscale.usage_envelope.v1`：`provider`、`model`、`medical_lane`、`source_role`、`usage.input_tokens` / `usage.output_tokens`。`medscale token ingest` 会自动识别并去重。

## 环境要求

- Node.js >= 20
- Python 3.10+
- Git（用于仓库变更追踪）
- 可选增强能力：gbrain、Graphify、CodeGraph、RTK、agentmemory

缺失的第三方能力不会阻断基础医学流程；它们会在 `medscale setup` 和 `medscale doctor` 中显示为 ready、partial、missing 或 planned。

## 18766 首页能看什么

- MedSCALE Research OS readiness score
- 研究团队角色与 review gates
- 医学 Prompt Studio 模板
- Runtime Doctor
- PubMed/OpenAlex、package audit、figure refs 深度检查
- 论文质量门禁
- 医学事实核查
- 交付 ZIP / package audit
- gbrain memory seed
- learning candidate
- Memory Brain approve/reject/stale/restore 审核动作
- Token / Cost 账本状态与医学 lane 汇总

## 最小验证

```bash
npm run typecheck
npm run build
npm run smoke:medscale-release
npm test -- tests/memory/MemoryReview.test.ts tests/cli/targetCommands.test.ts tests/cli/medscaleCli.test.ts
cd target-research-platform
python -m pytest tests/test_deliverables.py
```
