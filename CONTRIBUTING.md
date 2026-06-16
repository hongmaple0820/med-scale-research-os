<!--
  Version: 1.0
  Last Updated: 2026-05-19
  Maintainer: SCALE Engine Team
-->
# Contributing to SCALE Engine

Thank you for your interest in contributing to SCALE Engine. This guide will help you get started.

## Development Environment

### Prerequisites

- **Node.js** 20+ (LTS recommended)
- **Bun** (for development, optional for production)
- **pnpm** (package manager)
- **SQLite** (bundled via better-sqlite3, no separate install needed)

### Setup

```bash
# Clone the repository
git clone https://github.com/anthropics/scale-engine.git
cd scale-engine

# Install dependencies
pnpm install

# Run tests
pnpm test

# Run lint
pnpm lint

# Type check
pnpm typecheck
```

### Optional Dependencies

- **Qdrant** — Required for vector-based lesson recall. Run via Docker:
  ```bash
  docker run -p 6333:6333 qdrant/qdrant
  ```
  If not available, SCALE falls back to keyword-based retrieval.

## Project Structure

```text
src/
├── artifact/      # Artifact types, FSM, SQLite store
├── core/          # EventBus, DI container, logger
├── guardrails/    # Hook gateway, detectors, roles
├── context/       # ContextBuilder, token budget
├── knowledge/     # KnowledgeBase, lesson extraction
├── tasks/         # TaskEngine, checkpoint, resume
├── evolution/     # BehaviorTracker, pattern detection
├── adapters/      # Agent adapters (Claude Code, Cursor, etc.)
├── api/           # CLI, MCP server, HTTP server
├── dashboard/     # Web dashboard
├── hooks/         # Hook deployment
├── skills/        # Skill registry and execution
├── routing/       # Model router
├── workflows/     # Workflow presets and orchestration
└── agents/        # Agent definitions and coordination
```

See [docs/01-ARCHITECTURE.md](docs/01-ARCHITECTURE.md) for the full 6-layer architecture.

## Code Standards

### TypeScript

- Strict mode enabled
- No `any` types (use `unknown` + type guards)
- Prefer `interface` over `type` for object shapes
- Use `const` assertions and literal types where applicable

### Naming

- `camelCase` for variables and functions
- `PascalCase` for types, interfaces, and classes
- `UPPER_SNAKE_CASE` for constants
- Boolean prefixes: `is`, `has`, `should`, `can`

### File Organization

- One module per file, max 800 lines
- Functions under 50 lines
- Max 4 levels of nesting (use early returns)

### Immutability

- Always create new objects, never mutate existing ones
- Use `readonly` for object properties where applicable
- Prefer spread operator over Object.assign

## Testing

### Framework

We use [Vitest](https://vitest.dev/) for all tests.

### Requirements

- **Minimum coverage:** 80%
- **Test types:** Unit + Integration (E2E for critical flows)
- **Pattern:** AAA (Arrange-Act-Assert)

### Running Tests

```bash
# All tests
pnpm test

# With coverage
pnpm test --coverage

# Specific file
pnpm test tests/artifact/fsm.test.ts

# Watch mode
pnpm test --watch
```

### Writing Tests

```typescript
import { describe, it, expect } from 'vitest'

describe('FSM.transition', () => {
  it('blocks transition when guard fails', async () => {
    // Arrange
    const artifact = createTestArtifact({ status: 'DRAFT' })
    const fsm = createTestFSM()

    // Act
    const result = await fsm.transition(artifact.id, 'freeze', { actor: systemActor })

    // Assert
    expect(result.success).toBe(false)
    expect(result.blockedBy).toHaveLength(1)
  })
})
```

## Git Workflow

### Branch Strategy (GitLab Flow)

- `master` — stable, always deployable
- `feature/*` — new features
- `fix/*` — bug fixes
- `docs/*` — documentation only

### Commit Format

```text
<type>: <description>

<optional body>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`

Examples:
```text
feat(guard): add OWASP injection detector
fix(fsm): prevent double transition on concurrent writes
docs(readme): add quickstart section
```

### Pull Requests

1. Create a branch from `master`
2. Make your changes with tests
3. Ensure `pnpm test` and `pnpm lint` pass
4. Open a PR with a clear description
5. Link related issues

## Adding a New Detector

Detectors are the core of SCALE's guardrail system. To add a new one:

1. Create a class implementing `Detector` interface in `src/guardrails/`
2. Register it in `src/guardrails/Gateway.ts`
3. Add configuration to `config.yaml` under `guardrails.preTool.detectors`
4. Write tests in `tests/guardrails/`

See [src/guardrails/advancedDetectors.ts](src/guardrails/advancedDetectors.ts) for examples.

## Adding a New Agent Adapter

1. Create `src/adapters/YourAdapter.ts` implementing `IAgentAdapter`
2. Register in `src/adapters/index.ts` (add to `ADAPTER_MAP`)
3. Add the platform type to `AgentPlatform` in `src/artifact/types.ts`
4. Write integration tests in `tests/integration/`
5. Update `docs/04-INTEGRATION.md`

See [src/adapters/ClaudeCodeAdapter.ts](src/adapters/ClaudeCodeAdapter.ts) as reference.

## Architecture Decisions

Before proposing significant changes, review existing [ADR](docs/06-DECISIONS.md). If your change affects a prior decision, open an issue first to discuss.

## Questions?

- Open a [GitHub Issue](../../issues) for bugs and feature requests
- Check [docs/](docs/) for architecture and design details

## License

By contributing, you agree that your contributions will be licensed under the same license as the project.
