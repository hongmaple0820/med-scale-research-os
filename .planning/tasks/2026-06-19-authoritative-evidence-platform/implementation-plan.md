# Implementation Plan - Governance Foundation Vertical Slice

Date: 2026-06-19
Level: CRITICAL
Plan ID: PLAN-2026-06-19-GOVERNANCE-FOUNDATION
Status: COMPLETE

## Spec

`2026-06-19-authoritative-evidence-platform` (`FROZEN`, ambiguity 10%)

## Consensus Planning

### Option A: Python standard-library governance kernel — selected

Add a small `src/research_os/` module using dataclasses, JSON manifests and append-only JSONL
review events.

Benefits:

- Fits the existing medical execution kernel.
- Works fully offline.
- Adds no production dependency.
- Easy to replace with SQLite/PostgreSQL behind the same contracts later.

Costs:

- File locking and concurrent multi-user writes are deferred.
- Index scans are suitable for V1/local projects, not large shared deployments.

### Option B: Reuse the TypeScript Artifact/FSM engine directly

Rejected for the first slice because Python analysis would require a cross-process bridge before the
data trust contract can be exercised. It remains a future integration option.

### Option C: Start with PostgreSQL and object storage

Rejected for the first slice because it adds deployment and migration risk before the manifest,
licensing and review contracts are proven.

## Contracts

### Source Registry

- Sources have stable IDs, authority, version, adapter ID, license scope and allowed uses.
- Only `approved` sources may ingest data.
- Restricted sources cannot enter public export.

### Artifact Manifest

- Schema: `medscale.artifact_manifest.v1`.
- Layers: `raw`, `normalized`, `analysis`.
- Required: project, source, stable record IDs, retrieval details, SHA-256, bytes, media type,
  producer, parent artifact IDs and initial review status.

### Three-Layer Store

- Paths remain inside the project root.
- Raw bytes are immutable through the API.
- Derived artifacts require approved parent artifacts.
- Content is verified against the manifest before use.

### Review Ledger

- Append-only JSONL events.
- Stages: acquisition, normalization, screening, intelligence.
- States: review_required, approved, rejected, revision_required, invalidated.
- Every decision records reviewer, timestamp, hashes, rule version, note and signature.
- Invalidating an upstream artifact invalidates all descendants.

### Reference Adapter

- Downloads one exact approved URL through an injected fetch function.
- Stores response headers and request metadata.
- Never interprets or summarizes downloaded content.

## Required Capabilities

- code-generation
- file-editing
- test-writing
- debugging
- medical-provenance-modeling
- secure-path-handling

## TDD Tasks

1. Reject unapproved sources and forbidden public export.
2. Ingest a raw file and verify manifest/hash/path.
3. Block normalization before acquisition approval.
4. Permit normalized and analysis derivation after approval.
5. Detect file tampering.
6. Reject path traversal filenames.
7. Invalidate descendant approvals after upstream invalidation.
8. Prove the HTTP reference adapter stores retrieval evidence.

## Pre-mortem

| Failure | Impact | Mitigation |
| --- | --- | --- |
| Path traversal writes outside workspace | Critical data/security breach | Resolve and validate every path against project root |
| Manifest claims a hash that does not match bytes | False provenance | Compute hash after write and verify before downstream use |
| Restricted source appears in public export | License breach | Source registry export policy is a hard gate |
| Derived artifact uses unapproved parent | Invalid downstream evidence | Require ledger approval for every parent |
| Upstream changes leave downstream approval valid | Stale conclusions | Descendant invalidation through lineage graph |
| Concurrent writes corrupt JSONL | Lost audit events | V1 documents single-process writer; add locking before multi-user mode |

## Rollback Strategy

### Code

- Remove `target-research-platform/src/research_os/`.
- Remove `target-research-platform/tests/test_research_governance.py`.
- Revert the test allowlist entry in `.gitignore`.

### Data

- The slice writes only to caller-provided temporary/project directories.
- No existing schema or production data is migrated.
- Rollback deletes only the newly created V2 project directory after verifying its resolved path.

### Verification

- Run the governance test file.
- Run the existing focused evidence-gate suite.
- Run `git diff --check`.

## Completion

The governance foundation vertical slice was completed on 2026-06-19. It does not complete the
seven-omics adapters, cross-source normalization, evidence matrix, intelligence packs, or research
workbench described in the parent plan.
