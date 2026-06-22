# Task - Adapter SDK and NCBI GEO Reference Slice

Date: 2026-06-19
Level: CRITICAL
Task ID: `TASK-2026-06-19-ADAPTER-SDK-GEO`
Implementation status: COMPLETE
Research workflow status: AWAITING_HUMAN_ACQUISITION_REVIEW

## Required Capabilities

- code-generation
- file-editing
- test-writing
- debugging
- secure-path-handling
- medical-provenance-modeling

## Files

- `target-research-platform/src/research_os/transport.py`
- `target-research-platform/src/research_os/geo.py`
- `target-research-platform/src/research_os/__init__.py`
- `target-research-platform/tests/test_adapter_sdk.py`
- `target-research-platform/tests/test_geo_reference_integration.py`
- `target-research-platform/config/reference_controls/ncbi_geo_gse1_v1.json`

## Human Gate

Review the local run summary, manifest, raw bytes, source URL, checksum, and schema profile. Approval
authorizes only the GSE1 acquisition-stage reference artifact. It does not approve a normalization
method, biological interpretation, target screening, or a general GEO adapter production release.
