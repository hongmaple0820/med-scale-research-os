# Phase 2 Plan - Adapter SDK and NCBI GEO Reference Slice

Date: 2026-06-19
Level: CRITICAL
Plan ID: `PLAN-2026-06-19-ADAPTER-SDK-GEO`
Status: COMPLETE — raw reference artifact awaits human acquisition review

## Parent

Frozen spec: `2026-06-19-authoritative-evidence-platform`
Parent phase: adapter SDK

The SCALE CLI generated `SPEC-20260619-0010` but kept it in `REVIEWING` because its generic prompt
optimizer reported 29% ambiguity. This implementation does not bypass that FSM. It proceeds under
the already frozen parent spec and the explicit scope below.

## Scope

- Standard-library byte-range downloader with safe local partial files.
- Expected SHA-256 and byte-count controls before raw ingestion.
- Strict GSE accession parser and official NCBI GEO HTTPS path builder.
- Deterministic GEO Series Matrix gzip/schema inspector.
- Fixed GSE1 reference control stored as JSON, not as a committed raw binary.
- Explicit opt-in live integration test against the official NCBI endpoint.

## Required Capabilities

- code-generation
- file-editing
- test-writing
- debugging
- secure-path-handling
- medical-provenance-modeling

## TDD Tasks

1. Resume a pre-existing partial download with `Range` and no duplicated bytes.
2. Restart safely when a server ignores `Range`.
3. Block unexpected size and checksum.
4. Resolve only uppercase `GSE` accessions to official NCBI paths.
5. Inspect required matrix markers and stable schema fields.
6. Block invalid gzip, accession mismatch, missing markers, and fixed-control drift.
7. Ingest the verified raw bytes with retrieval and schema evidence.
8. Run the GSE1 control as an explicit network integration test.

## Rollback

- Remove `src/research_os/transport.py` and `src/research_os/geo.py`.
- Remove the two Phase 2 test files and GSE1 control JSON.
- Revert exports and `.gitignore` allowlist entries.
- Delete only caller-provided download workspaces after checking resolved paths.
- Never overwrite or delete an existing raw artifact during rollback.

## Completion

- TDD RED: imports failed before the SDK modules existed.
- GREEN: offline adapter and governance contracts passed.
- REFACTOR: default transport now streams into `.part` and preserves received bytes after an
  interrupted connection.
- Live control: the official GSE1 file matched the pinned byte count, SHA-256, and schema profile.
- Workflow stop: the generated raw artifact remains `review_required`.
