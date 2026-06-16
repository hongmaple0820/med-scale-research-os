# Context Budget And Progressive Governance

Status: implemented baseline
Since: v0.20 development branch

This feature keeps SCALE from becoming its own context pollution source. It separates always-loaded rules from on-demand documents, runtime evidence, historical archives, and generated artifacts.

## Commands

Report token cost by context category:

```bash
scale context budget --json
```

Include provider-specific prompt cache policy:

```bash
scale context budget --provider anthropic --json
scale context budget --provider openai --json
```

Write the report to `.scale/context-budget.json`:

```bash
scale context budget --write
```

Check thresholds:

```bash
scale context doctor --max-always 1500 --max-task 4000
```

Build a lazy-loaded task context pack:

```bash
scale context pack \
  --task "Review frontend route with browser evidence" \
  --level L \
  --files src/routes/upload.tsx \
  --budget 4000 \
  --json
```

Build the unified AI OS runtime plan that embeds the context pack with memory, skill routing, evaluator intelligence, tool strategy, adaptive workflow, and ROI:

```bash
scale ai-os plan \
  --task-id TASK-123 \
  --task "Review frontend route with browser evidence" \
  --level L \
  --files src/routes/upload.tsx \
  --budget 4000 \
  --json
```

The context pack now uses the baseline Context Compiler. Each candidate section is scored by category, task/file relevance, risk level, and budget fit. The JSON output includes compiler metadata so callers can explain why a section was loaded or omitted:

```json
{
  "compiler": {
    "strategy": "relevance-budget-v1",
    "budget": 4000,
    "totalCandidateTokens": 6200,
    "estimatedTokenSavings": 2200,
    "ranking": [
      {
        "id": "runtime-evidence",
        "included": true,
        "score": 292,
        "matchedSignals": ["evidence", "high-risk-evidence"],
        "reason": "Evidence is needed for completion and verification claims."
      }
    ]
  }
}
```

Evaluate progressive governance mode:

```bash
scale governance mode \
  --task "Change auth permissions and database migration" \
  --files src/auth/user.ts,migrations/001.sql \
  --requested-mode minimal \
  --json
```

Report governance benefit and overhead:

```bash
scale governance roi \
  --task-id TASK-123 \
  --task "Review frontend route with browser evidence" \
  --files src/routes/upload.tsx \
  --json
```

## Categories

| Category | Meaning | Loading Policy |
| --- | --- | --- |
| `always` | Tiny entrypoint rules and source-of-truth governance config | Keep under strict token budget |
| `on-demand` | Domain docs and governance guides | Load only when task trigger matches |
| `evidence` | Runtime evidence and task artifacts | Summarize and reference by path |
| `archive` | Historical plans and old roadmap context | Do not load unless explicitly requested |
| `generated` | HTML reports, screenshots, graph outputs, generated artifacts | Keep manifest-only by default |

## Prompt Cache Policy

V2.0 adds a cache policy layer for stable context. The policy is intentionally conservative:

- `always` is cache-eligible by default because it contains stable entrypoint rules and governance source-of-truth config.
- `on-demand` is not cache-eligible by default because it changes with task intent and can break stable prefix reuse.
- `evidence`, `archive`, and `generated` are never cache-eligible by default.
- Unsupported providers still write usage evidence; they do not pretend to support prompt caching.

Provider behavior:

| Provider | Strategy | Usage fields |
| --- | --- | --- |
| Anthropic | `anthropic-ephemeral` | `cache_creation_input_tokens`, `cache_read_input_tokens` |
| OpenAI | `openai-automatic` | `prompt_tokens_details.cached_tokens` |
| Other | `usage-ledger-only` | normal input/output usage only |

The cache policy does not live in `ModelRouter`. `ModelRouter` selects a model; provider request builders or adapters apply provider-specific cache controls.

To replace estimates with real usage evidence, write provider usage into the ledger and audit it directly:

```bash
scale token record \
  --provider anthropic \
  --usage-json '{"usage":{"input_tokens":1000,"output_tokens":200,"cache_read_input_tokens":500}}'

scale token report --day 2026-05-23 --json
```

## Progressive Governance

SCALE now has a baseline risk classifier. It keeps low-risk documentation work in `minimal` mode and escalates risky tasks to `standard`, `expanded`, or `critical`.

Examples:

| Signal | Mode |
| --- | --- |
| README typo | `minimal` |
| normal implementation task | `standard` |
| UI, browser, E2E, public interface, or cross-module work | `expanded` |
| auth, permission, secret, database, migration, production config, release, or destructive operation | `critical` |

This is not a replacement for verification. It only decides which governance behavior should activate.

## Governance ROI

`scale governance roi` reports both benefit and overhead. In v0.27.0, `scale ai-os plan` also attaches ROI modules for:

- `context-budget`
- `context-compiler`
- `memory-provider-runtime`
- `skill-routing-engine`
- `progressive-governance`

Early ROI is still estimated from context budget, compiler savings, recall count, skill evidence steps, and risk signals. Later versions should replace estimates with measured eval data such as file reads saved, tool calls saved, fix iterations reduced, and human corrections avoided.

