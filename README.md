# MedSCALE Research OS

MedSCALE Research OS（MedSCALE 医研操作系统）是一个面向医学研究工作流的本地研究操作系统。它把靶点/疾病研究、文献评审、事实核查、交付包审计、记忆播种、learning candidate 审核和研究者 dashboard 组织成可验证、可复核、可沉淀的闭环。

> MedSCALE 只用于研究工作流治理和证据组织，不提供临床诊断、治疗建议或投稿保证。所有医学结论都需要人类专家复核。

源码仓库：https://github.com/hongmaple0820/med-scale-research-os
npm 包名：`@hongmaple0820/med-scale-research-os`
语言：[中文](README.md) | [English](README.en.md)

## 当前状态

- 产品名：**MedSCALE Research OS / MedSCALE 医研操作系统**
- 主入口：`medscale`
- 本地 dashboard：`http://127.0.0.1:18766`
- 医学执行内核：`target-research-platform`
- 记忆供应商：gbrain ready，agentmemory 未启用
- 代码/知识图谱：Graphify ready，CodeGraph partial
- MCP：已有 MedSCALE server map，live health 仍待深化
- Native doctor：已纳入 PubMed/OpenAlex、package audit、figure refs、token/cost 深度检查
- 已有本地可视化安装向导：`medscale setup --visual --lang zh`
- Token/cost：本地账本、CLI record/report/ingest、usage envelope 和 18766 面板已接入；交付包会自动扫描真实医学 usage 产物
- 待补能力：npm 首次发布后的 npx 验证、live MCP health、真实外部模型调用回放验证

## 快速开始

本地开发：

```bash
npm install
npm run build
npm run medscale -- doctor --json
npm run medscale -- setup --lang zh
npm run medscale -- setup --visual --lang zh
npm run medscale -- dashboard
```

构建后直接运行：

```bash
node dist/api/medscale.js doctor --json
node dist/api/medscale.js setup --lang zh
node dist/api/medscale.js setup --visual --lang zh
node dist/api/medscale.js dashboard
```

未来发布后目标入口：

```bash
npx -y @hongmaple0820/med-scale-research-os setup --lang zh
npx -y @hongmaple0820/med-scale-research-os setup --visual --lang zh
npx -y @hongmaple0820/med-scale-research-os doctor --json
npx -y @hongmaple0820/med-scale-research-os dashboard
```

## 核心命令

```bash
medscale doctor --json
medscale setup --lang zh
medscale setup --lang en
medscale setup --visual --lang zh
medscale os-plan --json
medscale token report --json
medscale token record --provider anthropic --medical-lane literature --usage-file usage.json --json
medscale token ingest --target CDK4 --disease "breast cancer" --json
medscale token ingest --file artifact-usage.json --provider anthropic --json
medscale dashboard
medscale memory-review approve --candidate-id <id> --json
medscale memory-review reject --candidate-id <id> --json
medscale memory-review stale --candidate-id <id> --json
medscale memory-review restore --candidate-id <id> --json
```

## 18766 研究者视图

首页卡片层已经展示：

- 论文质量门禁
- 医学事实核查
- 交付 ZIP / package audit
- gbrain memory seed
- learning candidate
- Memory Brain review 状态
- Token / Cost 面板
- MedSCALE Research OS runtime doctor
- 医学 Prompt Studio 模板

learning candidate 卡片支持四个显式审核动作：

- 批准：promote 为 active Memory Brain node
- 拒绝：标记为 rejected
- 标记过期：标记为 stale
- 恢复复审：恢复为 candidate 状态

这些动作会写入：

- `.scale/memory/learning-candidates/<candidate>.review.json`
- `.scale/memory/learning-candidates/<candidate>.review.md`

## 医学专用能力

已配置的 MedSCALE skill domains：

- `medicalLiteratureReview`
- `medicalFactCheck`
- `medicalEvidenceGrading`
- `medicalStatisticalReview`
- `medicalPackageAudit`
- `medicalMemoryCurator`

已配置的 MedSCALE MCP route ids：

- `medical-literature`
- `medical-fact-check`
- `medical-memory-review`
- `medical-package-audit`
- `medical-evidence-manifest`

## 跨平台目标

`medscale setup` 会按平台给出显式安装/验证命令，覆盖：

- Windows
- macOS
- Linux

第三方能力不会静默自动安装。缺失能力会进入 setup/doctor 的 ready、partial、missing、planned 状态矩阵。

## 验证

推荐最小验证：

```bash
npm run typecheck
npm run build
npm run smoke:medscale-release
npm test -- tests/memory/MemoryReview.test.ts tests/cli/targetCommands.test.ts tests/cli/medscaleCli.test.ts
cd target-research-platform
python -m pytest tests/test_deliverables.py
```

当前已验证的关键结果：

- MedSCALE release smoke：`medscale.release_smoke.v1 passed`
- Dashboard deliverables tests：`25 passed`
- Memory review CLI tests：approve / reject / stale / restore 已覆盖
- 18766 页面渲染：Memory review 按钮可见，无页面错误

## 仓库说明

这个仓库从通用 SCALE Engine 治理内核演进而来。历史治理模块仍保留在源码中，供 MedSCALE 复用工程门禁、skills、MCP、记忆和证据结构；医学研究工作流的用户入口以 `medscale` 为准，不要求用户通过 `scale` CLI 运行医学流程。

## License

[MIT](LICENSE)
