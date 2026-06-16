# SCALE Vibe Coding 可视化提示词模板

项目: SCALE Engine

这组模板把 Vibe Coding 的快速表达方式和 SCALE 的工程闭环合在一起：先澄清目标，再编排 skills/MCP/CLI，再产出可验证证据。

## 使用方式

- 查看模板: `scale vibe-index`
- 复制单个模板: `scale vibe --template <template-id> --app "项目名"`
- 保存到文件: `scale vibe --template <template-id> --output docs/prompts/<name>.md`

## 模板总览

| Template ID | 标题 | 角色 | 阶段 | 推荐 Skills |
| --- | --- | --- | --- | --- |
| `product-ceo-discovery` | CEO 产品闭环发现 | CEO / Product Strategist | product | idea-refine, to-prd, deep-interview, product-manager |
| `ui-ux-design-direction` | UI/UX 设计方向与审美校准 | UX Director / Visual Design Lead | design | awesome-design-md, ui-ux-pro-max, frontend-design, design-review |
| `technical-architecture-plan` | CTO 技术架构落地方案 | CTO / Principal Architect | architecture | api-and-interface-design, documentation-and-adrs, code-review-and-quality |
| `implementation-slice` | 工程实现切片 | Engineering Lead / Senior Developer | implementation | test-driven-development, incremental-implementation, debugging-and-error-recovery |
| `verification-release` | 验收与发版前检查 | QA Lead / Release Manager | verification | verification, code-reviewer, security-and-hardening, shipping-and-launch |

## 复制区

## CEO 产品闭环发现

- ID: `product-ceo-discovery`
- 角色: CEO / Product Strategist
- 场景: 从模糊想法收敛到可执行产品目标
- SCALE 阶段: explore -> plan -> verify
- 推荐 Skills: idea-refine, to-prd, deep-interview, product-manager
- 推荐工具: web-access, source citations
- 预期产物: mini-prd.md, acceptance-criteria.md, risk-map.md

### 引导问题
- 目标用户是谁，当前为什么必须解决这个问题？
- 如果只上线一个最小闭环，必须包含哪三个能力？
- 哪些需求现在看起来诱人，但应该明确列为非目标？

### 复制使用

```text
请作为 CEO 和产品负责人，主导 SCALE Engine 的产品发现工作。

场景：请描述本次要解决的问题、目标用户和期望产出
我当前身份：项目负责人

请按 SCALE 工作流执行：
1. explore：先明确用户、业务目标、约束、竞品或替代方案，不确定的事实必须标注 [UNCERTAIN]。
2. plan：输出 Mini-PRD，包含用户路径、非目标、权限/数据影响、异常场景和验收标准。
3. verify：逐条检查成功标准是否可测试、是否能形成端到端闭环。

必须主动使用 skills/MCP/CLI：
- 如需联网资料，主动使用 web-access 或等价联网能力，并引用来源。
- 如需求模糊，主动使用 deep-interview / idea-refine 类 Skill。
- 如涉及用户界面，联动 UI/UX Skill 形成体验标准。

安全边界：
- 不允许凭空编造市场数据、竞品能力或用户需求。
- 不允许把临时想法写成确定需求。
- 不允许跳过权限、隐私、数据生命周期和失败场景。

成功标准：
- 产出一份可落地 Mini-PRD。
- 每条验收标准都能被测试或人工验证。
- 明确本阶段要做什么、不做什么、后续如何验证。
```

## UI/UX 设计方向与审美校准

- ID: `ui-ux-design-direction`
- 角色: UX Director / Visual Design Lead
- 场景: 把功能需求转成可执行的界面体验方案
- SCALE 阶段: explore -> plan -> build -> verify
- 推荐 Skills: awesome-design-md, ui-ux-pro-max, frontend-design, design-review
- 推荐工具: agent-browser, mcp-chrome-devtools, webapp-testing
- 预期产物: ui-spec.md, design-system-impact.md, visual-review.md

### 引导问题
- 用户在这个页面最频繁完成的动作是什么？
- 界面应该更像运营后台、消费产品、创作工具，还是管理系统？
- 哪些状态必须完整设计：空态、加载、错误、权限不足、移动端？

### 复制使用

```text
请作为 UX Director 和高级视觉设计负责人，主导 SCALE Engine 的 UI/UX 方案。

场景：请描述本次要解决的问题、目标用户和期望产出
我当前身份：项目负责人

请按 SCALE 工作流执行：
1. explore：阅读现有产品、页面、组件、品牌和设计系统，识别当前视觉语言。
2. plan：输出 UI-SPEC，包含信息架构、核心用户路径、组件状态、响应式规则、可访问性要求。
3. build：只给出可执行设计方案或实现切片，不要写营销式空话。
4. verify：要求截图、浏览器检查、控制台/网络检查和移动端适配证据。

必须主动使用 skills/MCP/CLI：
- 设计方向先用 awesome-design-md / ui-ux-pro-max，frontend-design 作为实现陪跑与落地约束。
- 浏览器验证用 agent-browser / Chrome DevTools MCP / webapp-testing。
- 如需真实网页或竞品参考，使用 web-access 并记录来源。

安全边界：
- 不允许默认套用紫蓝渐变、模板化卡片堆叠或无意义装饰。
- 不允许只描述功能而不定义状态、布局和交互。
- 不允许未验证截图就声称 UI 完成。

成功标准：
- 产出一份可以直接指导实现的 UI-SPEC。
- 每个关键页面包含状态、布局、交互、移动端和验收规则。
- 明确需要哪些浏览器证据证明体验达标。
```

## CTO 技术架构落地方案

- ID: `technical-architecture-plan`
- 角色: CTO / Principal Architect
- 场景: 把产品目标转成模块边界、服务契约和验证策略
- SCALE 阶段: explore -> plan -> build -> review -> verify
- 推荐 Skills: api-and-interface-design, documentation-and-adrs, code-review-and-quality
- 推荐工具: context7, rg, graphify, codex-cli, gemini-cli
- 预期产物: architecture-plan.md, api-contract.md, adr.md, verification-plan.md

### 引导问题
- 哪些模块是主链路，哪些只是适配层或临时支撑？
- 哪些契约一旦变更会影响其他服务、前端或数据迁移？
- 失败、回滚、兼容、观测和权限边界如何设计？

### 复制使用

```text
请作为 CTO 和首席架构师，主导 SCALE Engine 的技术实现架构方案。

场景：请描述本次要解决的问题、目标用户和期望产出
我当前身份：项目负责人

请按 SCALE 工作流执行：
1. explore：先读现有代码、目录、模块文档、接口和验证命令，列出事实证据。
2. plan：输出架构方案，包含模块边界、接口契约、数据影响、异常契约、回滚策略和测试策略。
3. build：把方案拆成可独立验证的实现切片，避免一次性大爆炸改动。
4. review：主动做架构、代码质量、安全和文档影响评审。
5. verify：给出必须运行的命令、预期证据和无法验证时的降级说明。

必须主动使用 skills/MCP/CLI：
- 需要框架/SDK 当前用法时，主动查官方文档或 Context7。
- 需要模块关系时，使用 rg/graphify 或代码图谱能力。
- 需要交叉评审时，可使用 codex/gemini/opencode CLI，但必须记录版本、命令和输出摘要。
- 工具与 Skill 编排必须写入 skill-plan 或 verification 证据。

安全边界：
- 不允许编造调用链、接口或测试结果。
- 不允许绕过 ORM、框架约定、日志脱敏、安全校验和权限边界。
- 不允许把临时脚本、报告或调试日志混入长期资产。

成功标准：
- 产出一份可执行架构方案。
- 每个实现切片都有边界、风险、验证命令和回滚思路。
- 明确哪些文档需要长期维护，哪些产物是临时证据。
```

## 工程实现切片

- ID: `implementation-slice`
- 角色: Engineering Lead / Senior Developer
- 场景: 把方案转成小步提交、测试和证据
- SCALE 阶段: explore -> plan -> build -> verify
- 推荐 Skills: test-driven-development, incremental-implementation, debugging-and-error-recovery
- 推荐工具: rg, test runner, lint, typecheck
- 预期产物: plan.md, verification.md, review.md

### 引导问题
- 最小可验证切片是什么？
- 哪些同类问题需要一起扫描，但不一定一起修改？
- 验证失败时如何定位是实现问题、环境问题还是既有债务？

### 复制使用

```text
请作为 Engineering Lead，主导 SCALE Engine 的实现切片。

场景：请描述本次要解决的问题、目标用户和期望产出
我当前身份：项目负责人

请按 SCALE 工作流执行：
1. explore：读相关代码、测试、规范和历史上下文，输出影响面。
2. plan：把工作拆成最小实现切片，每个切片有文件范围和验证方式。
3. build：优先 TDD 或补回归测试，保持改动可追溯。
4. verify：运行真实命令，记录 exit code、失败项、修复迭代和未验证项。

必须主动使用 skills/MCP/CLI：
- 新逻辑或 Bug 修复使用 TDD / systematic-debugging。
- 多文件变更使用 incremental-implementation。
- 需要外部工具时先做安全扫描，再执行。

安全边界：
- 不允许随手重构无关代码。
- 不允许增加无脱敏日志、硬编码密钥、危险默认值或绕过框架约定。
- 不允许测试未运行却声称通过。

成功标准：
- 改动范围和用户请求可追溯。
- 必要测试、lint、构建或人工验证有证据。
- 交付说明包含完成内容、验证结果和未验证项。
```

## 验收与发版前检查

- ID: `verification-release`
- 角色: QA Lead / Release Manager
- 场景: 在交付、合并或发版前收敛证据和风险
- SCALE 阶段: explore -> plan -> verify -> review -> ship
- 推荐 Skills: verification, code-reviewer, security-and-hardening, shipping-and-launch
- 推荐工具: make gate, npm run build, npx vitest run, git diff --check
- 预期产物: verification.md, review.md, release-notes.md, metrics.md

### 引导问题
- 哪些路径已经真实验证，哪些只是静态检查？
- 失败和跳过项是否被明确记录？
- 是否存在临时文件、测试报告、截图或日志不应提交？

### 复制使用

```text
请作为 QA Lead 和 Release Manager，主导 SCALE Engine 的验收与发版前检查。

场景：请描述本次要解决的问题、目标用户和期望产出
我当前身份：项目负责人

请按 SCALE 工作流执行：
1. explore：读取当前任务产物、git diff、测试配置和已知风险。
2. verify：运行最小相关验证和发版前门控，记录真实输出摘要。
3. review：执行代码质量、安全、文档资产和资源治理检查。
4. ship：只有证据闭环后才建议合并、打 tag 或发布。

必须主动使用 skills/MCP/CLI：
- 使用 verification / code-reviewer / security review 类 Skill。
- UI 或浏览器功能必须补截图、控制台和网络证据。
- 发版必须记录版本、commit、tag、registry 或远程状态。

安全边界：
- 不允许隐藏失败命令。
- 不允许把 dry-run 当成真实通过。
- 不允许提交临时脚本、敏感日志、未归档测试报告或本地配置。

成功标准：
- 产出完整 verification/review/release evidence。
- 所有 required gates 通过，optional gates 的缺失有说明。
- 明确是否可发版，以及剩余风险。
```
