# SCALE Engine Migration Guide

Breaking changes and migration paths between major versions.

## 0.26.0 → 0.42.0 (Three-Engine Architecture)

This is the largest architectural change in SCALE Engine history. The monolithic governance engine was decomposed into three specialized engines.

### Breaking Changes

#### CLI Restructuring

The `scale` CLI was restructured from a flat command namespace to a nested subcommand tree (66+ commands). Scripts calling `scale <command>` may need updating:

| Old (≤0.26) | New (0.42+) |
|---|---|
| `scale init` | `scale init` (unchanged, but new options) |
| `scale verify` | `scale verify` or `scale gate run` |
| `scale context inject` | `scale cortex inject` |
| `scale review` | `scale review` (unchanged) |
| `scale ship` | `scale ship` (unchanged) |

New command groups:
- `scale shield compile|status|test` — Hook-based deterministic interception
- `scale orch start|stop|status|log` — Declarative daemon orchestration
- `scale cortex extract|inject|metrics|evolve|verify` — Evidence-driven learning
- `scale upgrade check|plan|apply|rollback` — Version migration

#### Gate System Expansion

Gates expanded from G0-G8 (9 gates) to G0-G22 (23 gates) across three tiers:

- **Core gates** (G0-G8): Existing behavior, no changes needed
- **Meta-governance gates** (G9-G15): Self-governance checks (default off)
- **Enhanced gates** (G16-G22): New gates for extended coverage

Existing `make gate-workflow` and `make gate-quality` targets were updated. Custom gate configurations in `.scale/workspace.json` remain compatible.

#### Three-Engine Architecture

The `src/` directory was reorganized:

- `src/shield/` — PolicyCompiler, ShieldProtocol, ProtectedPaths
- `src/orchestrator/` — PolicyLoader, WorkspaceManager, ReconciliationLoop, TrackerAdapter
- `src/cortex/` — InstinctExtractor, InstinctStore, SessionInjector, ReflexionEngine, GovernanceMetrics

Import paths for internal modules changed. If you imported from `src/core/` or `src/governance/`, update to the engine-specific paths.

#### Governance Lock Format

`.scale/governance.lock.json` schema unchanged, but the `scaleVersion` field must match the installed package version. Regenerate with:

```bash
scale upgrade apply --dir . --confirm
```

#### Hook Scripts

Hook scripts under `.claude/hooks/` were updated for the new exit-code protocol (0=allow, 2=block). Existing custom hooks remain functional but should be tested against the new Shield protocol.

## 0.20.0 → 0.26.0

### Agent Platform Changes

- `AgentPlatform` type expanded to 17+ platforms
- `SUPPORTED_AGENTS` array now includes deepseek-tui, kiro, and others
- Custom adapter implementations may need to implement new interface methods

### Workflow Artifact Changes

- `.scale/state/` directory structure changed
- `explore.json`, `plan-{id}.json`, `tdd-{taskId}.json` artifact schemas evolved
- Old artifacts are automatically migrated on first `scale verify`

## 0.10.0 → 0.20.0

### Phase Workflow Introduction

The `define → plan → build → verify → review → ship` phase workflow was introduced:

- `scale define` replaces manual spec creation
- `scale plan` replaces manual planning
- `scale build` replaces manual implementation tracking
- Verification evidence persisted under `.scale/evidence/`
- Review records persisted under `.scale/reviews/`

### Hook System Changes

- Hook templates moved from inline to `src/hooks/templates/`
- `HookGeneratorEnhanced` introduced with 4 built-in templates
- `HookDeployer` added for backup/rollback of hook configurations

## 0.7.0 → 0.10.0

### FSM and Evolution System

- `FSMAgentBridge` introduced for artifact state awareness
- `EvolutionEngine` and `AutoDefectCreator` added
- `BehaviorTracker` with automatic evolution triggers
- `DashboardServer` for web-based monitoring

## General Migration Steps

1. **Backup**: `cp -r .scale .scale.backup`
2. **Update**: `npm install -g @hongmaple0820/scale-engine@latest`
3. **Check**: `scale upgrade check --dir .`
4. **Plan**: `scale upgrade plan --dir .`
5. **Apply**: `scale upgrade apply --dir . --confirm`
6. **Verify**: `scale verify --dir .`
7. **Rollback** (if needed): `scale upgrade rollback --dir .`

## Deprecation Timeline

| Deprecated | Removed | Replacement |
|---|---|---|
| `scale context inject` (standalone) | 0.43.0 | `scale cortex inject` |
| `scale doctor` (standalone) | 0.43.0 | `scale verify` |
| Legacy hook format (exit 0/1) | 0.44.0 | Shield exit protocol (0/2) |
| `.scale/state/` flat artifacts | 0.44.0 | Engine-specific state dirs |
