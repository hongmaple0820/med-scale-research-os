# Prompt Optimization

`scale prompt optimize` is the deterministic pre-execution prompt rewrite layer for coding tasks. It turns a raw user instruction into a structured, professional, executable prompt before the workflow asks an agent to plan or implement.

## Why It Exists

- Reduce model ambiguity before expensive model calls.
- Preserve the user's real intent instead of inventing a new requirement.
- Add missing execution structure: objective, context, boundaries, acceptance criteria, validation, deliverables, and risks.
- Make `scale define` start from a higher-quality requirement, so downstream planning and verification have clearer input.

## CLI

```bash
scale prompt optimize --input "Build a CLI prompt optimizer that rewrites raw coding requests" --json
```

Useful options:

- `--language auto|zh|en`: choose output language. `auto` detects Chinese vs English.
- `--title "Prompt Optimizer"`: add a task title to the optimized objective.
- `--files "src/api/cli.ts,src/prompts/PromptOptimizer.ts"`: add known file scope.
- `--service "api,workflow"`: add known service scope.
- `--success-criteria "structured prompt,preserves intent,validation evidence"`: seed acceptance criteria.

## Workflow Integration

`scale define` now runs prompt optimization before ambiguity scoring and spec creation:

```bash
scale define "Prompt Optimizer" \
  --description "用户输入后自动整理成专业 coding prompt，要保留真实意图" \
  --success-criteria "生成结构化提示词,保留用户原始意图,输出验收标准" \
  --json
```

The JSON result includes `promptOptimization`, and `spec.payload.what` stores the optimized prompt used by the rest of the workflow.

## Governance Rules

- The optimizer is algorithmic and does not call a model.
- It must not silently change the user's scope.
- It may add generic execution standards, validation requirements, and clarification questions.
- Vague input is still accepted, but the `quality.missingInfo` list must expose missing acceptance criteria, affected scope, or constraints.
