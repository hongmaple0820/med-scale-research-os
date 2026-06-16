# Memory Brain

Memory Brain is SCALE's project-scoped long-term memory layer. It is separate from Memory Fabric:

- Memory Fabric builds a compact context pack for the current task.
- Memory Brain stores reviewed project knowledge with evidence, confidence, scope, and contradiction checks.

The first version is local-first and uses SQLite:

```text
.scale/memory/brain.sqlite
.scale/memory/brain-manifest.json
```

## Commands

```bash
scale memory ingest --from evidence --task-id <task-id>
scale memory ingest --from candidate --candidate-id <candidate-id>
scale memory ingest --from failure --failure-id <failure-replay-id>
scale memory query "OAuth callback state design"
scale memory contradictions
scale memory dream
scale memory promote <memory-node-id-or-candidate-id>
scale memory export --output .scale/memory/export.jsonl
scale memory import .scale/memory/export.jsonl
```

## Node Contract

```ts
interface MemoryNode {
  id: string
  type: 'fact' | 'decision' | 'incident' | 'relation' | 'contradiction'
  title: string
  summary: string
  entities: string[]
  source: 'runtime-evidence' | 'task-artifact' | 'docs' | 'git' | 'manual'
  evidencePaths: string[]
  confidence: number
  scope: 'project' | 'workspace' | 'global-candidate'
  status: 'candidate' | 'active' | 'stale' | 'rejected'
  createdAt: string
  updatedAt: string
  lastVerifiedAt?: string
}
```

## Evidence Rule

Active memory must have at least one evidence path. SCALE blocks promotion when this is not true.

Runtime evidence and learning candidates are ingested as `candidate` records first. `scale memory promote` is the explicit boundary where reviewed memory becomes active.

Failure replay records can also be ingested as `incident` candidates:

```bash
scale eval run --suite workflow-baseline
scale eval failures --since 30d
scale memory ingest --from failure --failure-id <failure-replay-id>
scale memory promote <memory-node-id>
```

This connects Eval Harness failures to long-term memory without automatically rewriting project standards. A failure becomes active memory only after promotion and only if the replay artifact is present as evidence.

## Scope Rule

Project memory stays project-scoped by default. `global-candidate` is allowed for export and review, but it cannot be activated inside a project brain. This prevents one project's temporary truth from becoming a global rule.

## Contradiction Rule

`scale memory contradictions` reports conflicts instead of resolving them automatically. Examples:

- one memory says a provider is enabled, another says it is disabled
- one memory says a route exists, another says it is missing
- one memory says an operation is allowed, another says it is blocked

The command exits non-zero when active contradictions exist.

## Dream Maintenance

`scale memory dream` is a maintenance pass. It reports:

- promotion candidates
- stale active memories
- duplicate groups
- contradictions
- suggested docs to update
- active memories missing evidence

It does not auto-promote standards, rewrite docs, or delete memories.

## Resource Lifecycle

Memory Brain files under `.scale/memory/` are local runtime state by default. Commit only curated exports, documented decisions, or task artifacts that were intentionally reviewed.

Recommended flow:

```text
runtime evidence -> memory settle -> memory ingest -> memory promote -> docs/standards update when stable
eval failure replay -> memory ingest --from failure -> memory promote -> workflow rule update when stable
```

This keeps memory useful without turning every session observation into permanent project truth.
