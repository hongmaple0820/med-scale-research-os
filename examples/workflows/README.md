# SCALE Engine Workflow Examples

本目录包含 DAG 工作流模板示例，展示多 Agent 并行协作能力。

## 工作流格式

```yaml
name: workflow-name
description: 工作流描述
version: "1.0.0"

llm:
  provider: claude-code | gemini-cli | deepseek | openai
  model: claude-sonnet-4 | gpt-4o | deepseek-chat

concurrency: 3  # 最大并行步骤数

inputs:
  - name: input_name
    required: true
    description: 输入参数描述
    default: "default_value"

steps:
  - id: step-id
    role: engineering/agent-profile-id
    task: 任务描述（可含 {{变量}}）
    output: output_variable_name
    depends_on: [step-id-1, step-id-2]  # 依赖的步骤（空则可并行）
    retry: 2
    timeout: 120

output_dir: ao-output/workflow-name
```

## DAG 执行规则

1. **Level 0**：无 `depends_on` 的步骤可立即并行执行
2. **Level N**：依赖 Level N-1 步骤完成后执行
3. **循环检测**：自动检测并报错循环依赖
4. **变量解析**：`{{output_name}}` 自动解析为前序步骤输出

## 示例工作流

| 工作流 | 描述 | 并行步骤数 |
|--------|------|-----------|
| code-review.yaml | 多 Agent 并行代码审查 | 3 |
| product-review.yaml | 产品需求评审流程 | 2 |
| feature-implementation.yaml | TDD 功能实现流程 | 4 |

## Agent Profile 映射

| Role ID | Agent Profile | 专业领域 |
|---------|---------------|---------|
| engineering/frontend-agent | Frontend Developer | UI/UX |
| engineering/backend-agent | Backend Developer | API/DB |
| engineering/test-agent | Test Engineer | TDD/E2E |
| engineering/code-review-agent | Code Reviewer | 质量/模式 |
| engineering/security-agent | Security Specialist | OWASP |
| engineering/product-agent | Product Manager | 需求 |
| engineering/ui-design-agent | UI/UX Designer | 视觉设计 |
| engineering/architect-agent | Software Architect | 架构设计 |
| engineering/docs-agent | Documentation Specialist | 文档 |

## 使用方法

```bash
# 执行工作流
scale workflow run examples/workflows/code-review.yaml --input target_branch=main

# 查看执行状态
scale workflow status <workflow-id>

# 列出可用工作流
scale workflow list
```
